# -*- coding: utf-8 -*-
"""Uti Like V5: garimpagem local assistida; categorias, metas e imagens públicas.
Requer Selenium, Chrome e permissão para acessar páginas do fornecedor.
Não contorna captcha/login e não garante estoque/preços/imagens.
"""
import csv
import json
import os
import tempfile
import re
import threading
import time
import tkinter as tk
from collections import OrderedDict
from datetime import datetime
from pathlib import Path
from tkinter import ttk, messagebox
from urllib.parse import urlparse, quote, urljoin
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

BASE = Path(__file__).resolve().parent
DATA = BASE / 'dados_garimpagem'
DATA.mkdir(exist_ok=True)
STATE = DATA / 'progresso.json'
SETTINGS = DATA / 'preferencias.json'
CREDENTIAL_SERVICE = 'UtiLike.Garimpagem.APIKey' 
CREDENTIAL_ACCOUNT = 'administrador'

def atomic_text(path, content, encoding='utf-8'):
    """Substitui um arquivo somente após gravar o conteúdo completo."""
    fd, temp = tempfile.mkstemp(prefix='.utilike-', suffix='.tmp', dir=str(path.parent))
    try:
        with os.fdopen(fd, 'w', encoding=encoding, newline='') as out:
            out.write(content)
            out.flush()
            os.fsync(out.fileno())
        os.replace(temp, path)
    finally:
        if os.path.exists(temp): os.unlink(temp)

def read_saved_items():
    if not STATE.exists(): return []
    data = json.loads(STATE.read_text(encoding='utf-8'))
    if not isinstance(data, list): raise ValueError('Formato de progresso inválido')
    return data

PRODUCT_RE = re.compile(r'^/item/(\d+)\.html$', re.I)
CATS = [
 ('Tecnologia','tecnologia'), ('Eletrônicos','eletronicos'),
 ('Celulares e acessórios','celulares acessorios'), ('Informática','informatica'),
 ('Casa e decoração','casa decoracao'), ('Cama, mesa e banho','cama mesa banho'),
 ('Esporte e lazer','esporte lazer'), ('Moda','moda'),
 ('Beleza e cuidados','beleza cuidados'), ('Ferramentas','ferramentas'),
 ('Brinquedos','brinquedos'), ('Automotivo','automotivo'), ('Pet shop','pet shop')]

def is_ali(url):
    p=urlparse(url)
    h=(p.hostname or '').lower()
    return p.scheme=='https' and (h=='aliexpress.com' or h.endswith('.aliexpress.com'))

def canonical(url):
    try:
        p=urlparse(url)
        if is_ali(url) and PRODUCT_RE.match(p.path):
            return 'https://pt.aliexpress.com'+p.path
    except Exception:
        pass
    return None

def image_url(url):
    try:
        p=urlparse(url)
        h=(p.hostname or '').lower()
        return p.scheme=='https' and (h.endswith('.aliexpress-media.com') or h=='aliexpress-media.com' or h.endswith('.alicdn.com') or h=='alicdn.com')
    except Exception: return False

class App:
    def __init__(self, root):
        self.root=root
        root.title('Uti Like | Garimpagem V6 (preços observados)')
        root.geometry('1050x760');root.minsize(800,600)
        self.driver=None
        self.stop=threading.Event()
        self.busy=False
        self.lock=threading.RLock()
        self.items=OrderedDict() # url -> {categoria, imagens, titulo, ...}
        self.categories=[] # (nome, endereco)
        self.checked={}
        self.target=tk.StringVar(value='100')
        self.start_url=tk.StringVar(value='https://pt.aliexpress.com/')
        self.render=tk.StringVar(value='https://utilike.onrender.com')
        self.token=tk.StringVar()
        self.remember_token=tk.BooleanVar(value=False)
        self._last_saved_token=None
        self.status=tk.StringVar(value='Aguardando coleta')
        self.images_enabled=tk.BooleanVar(value=False)
        self.image_limit=tk.StringVar(value='10')
        self.image_products=tk.StringVar(value='10')
        self.only_products=tk.BooleanVar(value=True)
        self.percat={}
        # Ajuste exclusivamente visual: rolagem vertical para a janela inteira.
        # A rolagem interna da lista de categorias permanece independente.
        viewport=ttk.Frame(root)
        viewport.pack(fill='both',expand=True)
        page_canvas=tk.Canvas(viewport,highlightthickness=0)
        page_scroll=ttk.Scrollbar(viewport,orient='vertical',command=page_canvas.yview)
        page_canvas.configure(yscrollcommand=page_scroll.set)
        page_scroll.pack(side='right',fill='y')
        page_canvas.pack(side='left',fill='both',expand=True)
        shell=ttk.Frame(page_canvas,padding=12)
        page_window=page_canvas.create_window((0,0),window=shell,anchor='nw')
        shell.bind('<Configure>',lambda event:page_canvas.configure(scrollregion=page_canvas.bbox('all')))
        page_canvas.bind('<Configure>',lambda event:page_canvas.itemconfigure(page_window,width=event.width))
        # O mouse rola a página, exceto quando estiver sobre a lista de categorias.
        def page_wheel(event):
            try:
                widget=root.winfo_containing(event.x_root,event.y_root)
                while widget is not None:
                    if widget == self.catcanvas:
                        return
                    widget=widget.master
                page_canvas.yview_scroll(-int(event.delta/120), 'units')
            except (tk.TclError, AttributeError):
                pass
        root.bind_all('<MouseWheel>',page_wheel,add='+')
        ttk.Label(shell,text='Garimpagem V6 (preços observados) — AliExpress',font=('Segoe UI',16,'bold')).pack(anchor='w')
        ttk.Label(shell,text='Quantidade significa URLs por categoria. Imagens são URLs separadas das URLs dos produtos.').pack(anchor='w',pady=4)
        bar=ttk.Frame(shell);bar.pack(fill='x',pady=5)
        ttk.Label(bar,text='Página inicial:').pack(side='left')
        ttk.Entry(bar,textvariable=self.start_url).pack(side='left',fill='x',expand=True,padx=8)
        ttk.Button(bar,text='Abrir Chrome',command=self.open_browser).pack(side='left')
        top=ttk.Frame(shell);top.pack(fill='x',pady=5)
        ttk.Label(top,text='URLs por categoria:').pack(side='left')
        ttk.Entry(top,textvariable=self.target,width=8).pack(side='left',padx=(6,20))
        ttk.Button(top,text='Descobrir categorias',command=self.discover).pack(side='left',padx=3)
        ttk.Button(top,text='Selecionar todas',command=lambda:self.toggle_all(True)).pack(side='left',padx=3)
        ttk.Button(top,text='Desmarcar todas',command=lambda:self.toggle_all(False)).pack(side='left',padx=3)
        catbox=ttk.LabelFrame(shell,text='Categorias — role para visualizar todas sem esconder os botões',padding=6)
        catbox.pack(fill='x',pady=4)
        catbar=ttk.Frame(catbox);catbar.pack(fill='x')
        self.catcount=ttk.Label(catbar,text='Categorias disponíveis: 0');self.catcount.pack(side='left')
        ttk.Button(catbar,text='Ver mais / menos',command=self.toggle_cat_height).pack(side='right')
        self.catcanvas=tk.Canvas(catbox,height=118,highlightthickness=0)
        self.cat_scroll=ttk.Scrollbar(catbox,orient='vertical',command=self.catcanvas.yview)
        self.catcanvas.configure(yscrollcommand=self.cat_scroll.set)
        self.cat_scroll.pack(side='right',fill='y')
        self.catcanvas.pack(side='left',fill='both',expand=True)
        self.catframe=ttk.Frame(self.catcanvas)
        self.catwindow=self.catcanvas.create_window((0,0),window=self.catframe,anchor='nw')
        self.catframe.bind('<Configure>',lambda e:self.catcanvas.configure(scrollregion=self.catcanvas.bbox('all')))
        self.catcanvas.bind('<Configure>',lambda e:self.catcanvas.itemconfigure(self.catwindow,width=e.width))
        self.cat_expanded=False
        opts=ttk.Frame(shell);opts.pack(fill='x',pady=2)
        ttk.Checkbutton(opts,text='Somente links de produtos (obrigatório)',variable=self.only_products,state='disabled').pack(side='left')
        controls=ttk.Frame(shell);controls.pack(fill='x',pady=6)
        for label,cmd in [('Iniciar coleta por categoria',self.collect),('Parar',self.request_stop),('Salvar TXT/CSV',self.save),('Carregar progresso',self.load),('Capturar imagens dos produtos',self.capture_images)]:
            ttk.Button(controls,text=label,command=cmd).pack(side='left',padx=(0,5))
        imgbar=ttk.Frame(shell);imgbar.pack(fill='x',pady=2)
        ttk.Label(imgbar,text='Produtos por execução:').pack(side='left')
        ttk.Entry(imgbar,textvariable=self.image_products,width=6).pack(side='left',padx=4)
        ttk.Label(imgbar,text='Máx. imagens por produto:').pack(side='left')
        ttk.Entry(imgbar,textvariable=self.image_limit,width=8).pack(side='left',padx=6)
        ttk.Label(imgbar,text='Somente galeria identificada.').pack(side='left',padx=6)
        ttk.Label(shell,textvariable=self.status,font=('Segoe UI',10,'bold')).pack(anchor='w',pady=5)
        self.grid=ttk.Treeview(shell,columns=('categoria','qtd','meta','estado'),show='headings',height=7)
        for k,title,width in [('categoria','Categoria',300),('qtd','URLs únicas',100),('meta','Meta',100),('estado','Situação',350)]:
            self.grid.heading(k,text=title);self.grid.column(k,width=width,anchor='w')
        self.grid.pack(fill='x',pady=5)
        self.install_categories([(n,'https://pt.aliexpress.com/w/wholesale-'+quote(q.replace(' ','-'))+'.html') for n,q in CATS])
        api=ttk.LabelFrame(shell,text='Envio opcional para fila do CronJob (Render → Neon)',padding=8)
        api.pack(fill='x',pady=5)
        ttk.Label(api,text='Render:').grid(row=0,column=0,sticky='w')
        ttk.Entry(api,textvariable=self.render,width=56).grid(row=0,column=1,sticky='ew',padx=6)
        ttk.Label(api,text='Chave exclusiva da Garimpagem:').grid(row=1,column=0,sticky='w')
        ttk.Entry(api,textvariable=self.token,show='*').grid(row=1,column=1,sticky='ew',padx=6)
        ttk.Checkbutton(api,text='Guardar chave no cofre do Windows',variable=self.remember_token,command=self.on_remember_toggle).grid(row=2,column=0,columnspan=2,sticky='w',pady=3)
        ttk.Button(api,text='Enviar URLs ao Neon',command=self.send).grid(row=3,column=1,sticky='e',pady=4)
        api.columnconfigure(1,weight=1)
        ttk.Label(api,text='O envio cadastra URLs pendentes, não publica produtos. Não compartilhe a chave.').grid(row=4,column=0,columnspan=2,sticky='w')
        self.log=tk.Text(shell,height=5,wrap='word');self.log.pack(fill='both',expand=True,pady=5)
        root.protocol('WM_DELETE_WINDOW',self.close)
        self.restore_preferences()
        self.load(silent=True)
        self.refresh()

    def restore_preferences(self):
        try:
            settings=json.loads(SETTINGS.read_text(encoding='utf-8')) if SETTINGS.exists() else {}
            if isinstance(settings,dict):
                base=settings.get('render')
                if isinstance(base,str) and base.startswith('https://'):self.render.set(base)
                self.remember_token.set(bool(settings.get('lembrar_token',False)))
            if self.remember_token.get():
                try:
                    import keyring
                    saved=keyring.get_password(CREDENTIAL_SERVICE,CREDENTIAL_ACCOUNT)
                    if saved:self.token.set(saved);self._last_saved_token=saved
                    else:self.logmsg('Chave não encontrada no cofre do Windows. Cole a chave configurada no Render.')
                except Exception as exc:
                    self.remember_token.set(False)
                    self.logmsg('Armazenamento seguro indisponível: '+str(exc)[:150])
        except (OSError,ValueError,TypeError) as exc:
            self.logmsg('Preferências não recuperadas: '+str(exc)[:150])

    def save_preferences(self):
        atomic_text(SETTINGS,json.dumps({'render':self.render.get().strip(),'lembrar_token':self.remember_token.get()},ensure_ascii=False,indent=2))

    def on_remember_toggle(self):
        if self.remember_token.get():
            try:
                import keyring
                backend=keyring.get_keyring()
                if getattr(backend,'priority',0)<=0:raise RuntimeError('Nenhum cofre seguro disponível')
                token=self.token.get().strip()
                if token:
                    keyring.set_password(CREDENTIAL_SERVICE,CREDENTIAL_ACCOUNT,token)
                    self._last_saved_token=token
                    self.logmsg('Chave guardada no cofre seguro do Windows.')
                else:self.logmsg('Cole a chave no campo para salvá-la no cofre do Windows.')
            except Exception as exc:
                self.remember_token.set(False)
                messagebox.showwarning('Armazenamento seguro','Não foi possível guardar o token. Instale a biblioteca keyring ou continue colando o token manualmente.\n'+str(exc)[:180])
        else:
            try:
                import keyring
                try:keyring.delete_password(CREDENTIAL_SERVICE,CREDENTIAL_ACCOUNT)
                except keyring.errors.PasswordDeleteError:pass
                self._last_saved_token=None
                self.logmsg('Chave anterior excluída do cofre de credenciais.')
            except ImportError:pass
            except Exception as exc:self.logmsg('Não foi possível apagar o token salvo: '+str(exc)[:150])
        try:self.save_preferences()
        except OSError as exc:self.logmsg('Preferências não salvas: '+str(exc)[:150])

    def store_token_if_opted_in(self, token):
        if not self.remember_token.get() or token==self._last_saved_token:return
        try:
            import keyring
            keyring.set_password(CREDENTIAL_SERVICE,CREDENTIAL_ACCOUNT,token)
            self._last_saved_token=token
            self.logmsg('Chave atualizada no cofre seguro do Windows.')
        except Exception as exc:self.logmsg('Token não salvo no cofre: '+str(exc)[:150])

    def logmsg(self,msg):
        def update():
            try:
                self.log.insert('end',f'[{datetime.now():%H:%M:%S}] {msg}\n');self.log.see('end');self.refresh()
            except tk.TclError: pass
        try:self.root.after(0,update)
        except RuntimeError:pass

    def run(self,func):
        if self.busy:
            self.logmsg('Uma operação já está em andamento.');return
        self.busy=True
        def task():
            try:func()
            except Exception as e:self.logmsg('ERRO: '+str(e))
            finally:self.busy=False;self.logmsg('Operação finalizada.')
        threading.Thread(target=task,daemon=True).start()

    def validate(self):
        try:n=int(self.target.get())
        except ValueError:raise ValueError('Quantidade deve ser um número inteiro.')
        if not 1<=n<=10000:raise ValueError('Informe de 1 a 10.000 URLs POR categoria.')
        return n

    def browser(self):
        if self.driver is None:
            from selenium import webdriver
            options=webdriver.ChromeOptions();options.add_argument('--start-maximized')
            self.driver=webdriver.Chrome(options=options)
        return self.driver

    def open_browser(self):
        u=self.start_url.get().strip()
        if not is_ali(u):messagebox.showwarning('URL','Informe endereço HTTPS do AliExpress.');return
        self.run(lambda:(self.browser().get(u),self.logmsg('Chrome aberto. Resolva eventuais verificações manualmente.')))

    def toggle_cat_height(self):
        self.cat_expanded=not self.cat_expanded
        self.catcanvas.configure(height=235 if self.cat_expanded else 118)

    def install_categories(self,entries):
        for child in self.catframe.winfo_children():child.destroy()
        previous={name:v.get() for name,v in self.checked.items()}
        self.categories=entries;self.checked={}
        self.catcount.configure(text=f'Categorias disponíveis: {len(entries)} — use a rolagem lateral')
        for i,(name,url) in enumerate(entries):
            var=tk.BooleanVar(value=previous.get(name,False))
            self.checked[name]=var
            ttk.Checkbutton(self.catframe,text=name,variable=var).grid(row=i//4,column=i%4,sticky='w',padx=8,pady=2)
        self.refresh()

    def toggle_all(self,value):
        for var in self.checked.values():var.set(value)
        self.refresh()

    def discover(self):
        def task():
            driver=self.browser()
            if not is_ali(driver.current_url):driver.get('https://pt.aliexpress.com/')
            self.logmsg('Buscando categorias visíveis na navegação do AliExpress...')
            links=driver.execute_script('''return Array.from(document.querySelectorAll('a[href]')).map(a=>({name:(a.innerText||a.getAttribute('title')||'').trim(),url:a.href})).filter(x=>x.name.length>=3&&x.name.length<=65)''')
            discovered=[];seen=set()
            for obj in links:
                name=' '.join(obj['name'].split());url=obj['url']
                if not is_ali(url):continue
                path=urlparse(url).path.lower()
                if '/category/' not in path and '/w/wholesale-' not in path:continue
                key=(name.lower(),url.split('?')[0])
                if key in seen:continue
                seen.add(key);discovered.append((name,url.split('?')[0]))
                if len(discovered)>=300:break
            if not discovered:
                self.logmsg('O site não expôs categorias navegáveis. Mantidas categorias predefinidas, com busca por palavra-chave; resultados não garantidos.')
                return
            self.root.after(0,lambda:self.install_categories(discovered))
            self.logmsg(f'{len(discovered)} categorias encontradas. Clique em Selecionar todas, se desejar.')
        self.run(task)

    def refresh(self):
        try:
            for row in self.grid.get_children():self.grid.delete(row)
            selected=[name for name,v in self.checked.items() if v.get()]
            try:target=int(self.target.get())
            except ValueError:target=0
            with self.lock:
                counts={name:sum(1 for x in self.items.values() if x['categoria']==name) for name in selected}
                total=len(self.items)
            for name in selected:
                n=counts[name];self.grid.insert('', 'end',values=(name,n,target,'Meta atingida' if target and n>=target else 'Aguardando / incompleta'))
            self.status.set(f'{total} URLs únicas coletadas | {len(selected)} categorias | meta planejada: {len(selected)*target} (pode haver duplicatas entre categorias)')
        except tk.TclError:pass

    def scrape_links(self,cat,limit):
        links=self.driver.execute_script('return Array.from(document.querySelectorAll("a[href]"),a=>a.href)')
        new=0
        with self.lock:
            count=sum(1 for obj in self.items.values() if obj['categoria']==cat)
            for raw in links:
                if count>=limit:break
                u=canonical(raw)
                if not u or u in self.items:continue
                self.items[u]={'categoria':cat,'imagens':[],'titulo':'','captura_imagens':'nao_verificado','preco_observado':None,'moeda_observada':None,'preco_status':'nao_verificado'}
                count+=1;new+=1
        return new,count

    def collect(self):
        try:limit=self.validate()
        except ValueError as e:messagebox.showwarning('Quantidade',str(e));return
        selected=[(name,url) for name,url in self.categories if self.checked[name].get()]
        if not selected:messagebox.showwarning('Categorias','Selecione uma ou mais categorias.');return
        if not messagebox.askyesno('Confirmar',f'Coletar até {limit} URLs por categoria em {len(selected)} categorias?\nMeta: {limit*len(selected)}. O tempo pode ser elevado.'):
            return
        def task():
            driver=self.browser();self.stop.clear()
            for cat,url in selected:
                if self.stop.is_set():break
                if not is_ali(url):self.logmsg('Categoria ignorada: URL inválida');continue
                self.logmsg('Abrindo categoria: '+cat)
                driver.get(url)
                self.stop.wait(3)
                stale=0
                for scroll in range(250):
                    if self.stop.is_set():break
                    new,count=self.scrape_links(cat,limit)
                    if scroll%5==0 or new:self.logmsg(f'{cat}: {count}/{limit}; rolagem {scroll+1}; +{new}')
                    if count>=limit:break
                    stale=stale+1 if new==0 else 0
                    if stale>=20:
                        self.logmsg(f'{cat}: sem novos produtos após 20 tentativas. Categoria incompleta.');break
                    driver.execute_script('window.scrollBy(0, Math.max(550, window.innerHeight*.9))')
                    if self.stop.wait(2.5):break
                self.save_files(notify=False)
            self.logmsg('Coleta encerrada. Dados salvos automaticamente em dados_garimpagem/.')
        self.run(task)

    def request_stop(self):self.stop.set();self.logmsg('Parada solicitada; progresso será preservado.')

    def save_files(self,notify=False):
        with self.lock:
            data=[{'url':u,**v} for u,v in self.items.items()]
        # Não apaga progresso existente quando a memória está vazia.
        if not data:
            self.logmsg('Nenhuma URL em memória; arquivos anteriores preservados.')
            return
        txt=DATA/'links_garimpados.txt';csvfile=DATA/'links_garimpados.csv';images=DATA/'imagens_produtos.csv'
        # Primeiro garante o progresso recuperável, depois exporta os CSV/TXT.
        atomic_text(STATE,json.dumps(data,ensure_ascii=False,indent=2))
        atomic_text(txt,'\n'.join(x['url'] for x in data)+'\n')
        import io
        buffer=io.StringIO(newline='')
        w=csv.writer(buffer,delimiter=';');w.writerow(['fornecedor','categoria','url_produto','titulo','url_imagem_principal','total_imagens','status_imagens','preco_observado','moeda','status_preco','frete_status','frete_observado','origem_envio','disponibilidade_status','estoque_observado'])
        for x in data:w.writerow(['AliExpress',x['categoria'],x['url'],x['titulo'],(x['imagens'] or [''])[0],len(x['imagens']),x['captura_imagens'],x.get('preco_observado') or '',x.get('moeda_observada') or '',x.get('preco_status','nao_verificado'),x.get('frete_status','nao_verificado'),x.get('frete_observado') if x.get('frete_observado') is not None else '',x.get('origem_envio') or '',x.get('disponibilidade_status') or 'nao_confirmado',x.get('estoque_observado') if x.get('estoque_observado') is not None else ''])
        atomic_text(csvfile,buffer.getvalue(),encoding='utf-8-sig')
        buffer=io.StringIO(newline='')
        w=csv.writer(buffer,delimiter=';');w.writerow(['id_produto','url_produto','categoria','ordem','url_imagem','status_validacao'])
        for x in data:
            for i,url in enumerate(x['imagens'],1):w.writerow([PRODUCT_RE.match(urlparse(x['url']).path).group(1),x['url'],x['categoria'],i,url,'pendente'])
        atomic_text(images,buffer.getvalue(),encoding='utf-8-sig')
        self.logmsg(f'Arquivos salvos: {len(data)} produtos, {sum(len(x["imagens"]) for x in data)} links de imagens.')
        if notify:self.root.after(0,lambda:messagebox.showinfo('Salvo','TXT, CSV e progresso salvos na pasta dados_garimpagem.'))

    def save(self):self.save_files(notify=True)

    def load(self,silent=False):
        if not STATE.exists():
            if not silent:messagebox.showinfo('Progresso','Nenhum progresso anterior encontrado.')
            return
        try:
            data=read_saved_items()
            with self.lock:
                for x in data:
                    if not isinstance(x,dict):continue
                    u=canonical(x.get('url',''))
                    if u and u not in self.items:self.items[u]={k:x.get(k) for k in ('categoria','imagens','titulo','captura_imagens','preco_observado','moeda_observada','preco_status','frete_status','frete_observado','frete_texto','origem_envio','origem_envio_texto','disponibilidade_status','estoque_observado','estoque_texto')}
            self.logmsg(f'Progresso recuperado: {len(self.items)} URLs únicas.')
        except (ValueError,OSError,TypeError) as e:
            if silent:self.logmsg('Progresso não carregado: '+str(e)[:150])
            else:messagebox.showerror('Erro',str(e))

    def capture_images(self):
        try:limit=int(self.image_products.get());max_imgs=int(self.image_limit.get())
        except ValueError:messagebox.showwarning('Limite','Informe números inteiros.');return
        if not 1<=limit<=500 or not 1<=max_imgs<=30:
            messagebox.showwarning('Limite','Use de 1 a 500 produtos por execução e 1 a 30 imagens por produto.');return
        def task():
            driver=self.browser();self.stop.clear();done=0
            with self.lock:urls=[u for u,x in self.items.items() if x.get('captura_imagens') not in ('galeria_identificada',) or not x.get('preco_observado') or x.get('frete_status') in (None,'nao_verificado','frete_nao_confirmado') or not x.get('origem_envio') or not x.get('disponibilidade_status')]
            for u in urls[:limit]:
                if self.stop.is_set():break
                driver.get(u)
                if self.stop.wait(3):break
                # Extrai somente imagens em contêineres de galeria de produto.
                # Não percorre imagens genéricas da página, anúncios ou recomendações.
                raw=driver.execute_script(r"""
                const selectors=[
                  '[class*="image-view"] img','[class*="imageView"] img',
                  '[class*="product-image"] img','[class*="productImage"] img',
                  '[class*="product-gallery"] img','[class*="productGallery"] img',
                  '[class*="slider"] [class*="image"] img',
                  '[data-pl="product-image"] img',
                  '[class*="magnifier"] img',
                  '[class*="gallery"] img'
                ];
                const candidates=[];
                for(const sel of selectors){
                  try {document.querySelectorAll(sel).forEach(img=>{
                    if(img.closest('header,footer,nav,[class*="recommend"],[class*="Recommend"],[class*="advert"],[class*="review"]'))return;
                    const sources=[img.getAttribute('data-src'),img.getAttribute('data-lazy-src'),img.currentSrc,img.src];
                    const srcset=img.getAttribute('srcset')||'';
                    if(srcset)srcset.split(',').forEach(x=>sources.push(x.trim().split(/\s+/)[0]));
                    for(const u of sources){if(u)candidates.push(u);}
                  });}catch(e){}
                }
                const title=document.querySelector('meta[property="og:title"]')?.content||document.title||'';
                const og=document.querySelector('meta[property="og:image"]')?.content||'';
                // OG é fallback somente quando a página é individual de produto.
                // Prioriza o preço atual principal visível; não lê preço riscado/parcelas.
                // Seletores baseados nos prints de DevTools, sujeitos a mudanças no site.
                const priceSelectors=['span[class*="price-default--current--"]','[class*="price-default--current"]','[class*="price--current"]','[class*="price-current"]','[class*="product-price"] [class*="current"]'];
                const visible=el=>!!el.getClientRects().length&&getComputedStyle(el).visibility!=='hidden';
                const excluded=el=>!!el.closest('del,s,[class*="original"],[class*="oldPrice"],[class*="installment"],[class*="recommend"],[class*="review"]');
                let priceTexts=[];
                for(const sel of priceSelectors){
                  const matches=[];
                  for(const el of document.querySelectorAll(sel)){
                    if(!visible(el)||excluded(el))continue;
                    const t=(el.innerText||el.textContent||'').trim();
                    if(t.length<100&&/R\$\s*[\d.,]+/.test(t)&&!el.querySelector('[class*="price-default--current--"]'))matches.push(t);
                  }
                  if(matches.length){priceTexts=[...new Set(matches)].slice(0,8);break;}
                }
                const shippingSelectors=['[class*="dynamic-shipping-contentLayout"]','[class*="dynamic-shipping-line"]','[class*="shipping-content"]','[class*="shipping-info"]'];
                const shippingTexts=[];
                for(const sel of shippingSelectors)for(const el of document.querySelectorAll(sel)){
                  if(!visible(el)||excluded(el))continue;
                  const t=(el.innerText||el.textContent||'').replace(/\s+/g,' ').trim();
                  if(t&&t.length<240)shippingTexts.push(t);
                }
                // Origem do envio: SOMENTE rótulos explícitos de envio, nunca país do domínio.
                const shippingOriginSelectors=['[class*="shipping"]','[class*="Shipping"]','[class*="delivery"]','[class*="Delivery"]'];
                const originTexts=[];
                for(const sel of shippingOriginSelectors)for(const el of document.querySelectorAll(sel)){
                  if(!visible(el)||excluded(el))continue;
                  const t=(el.innerText||'').replace(/\s+/g,' ').trim();
                  if(t.length>0&&t.length<180&&/(enviado de|envia de|envio de|ships from|ship from|origem do envio|local de envio)/i.test(t))originTexts.push(t);
                }
                // Estoque: texto da seção de compra, não números de avaliações/vendas.
                const availabilitySelectors=['[class*="quantity"]','[class*="Quantity"]','[class*="inventory"]','[class*="Inventory"]','[class*="stock"]','[class*="Stock"]','[class*="sku"]'];
                const availabilityTexts=[];
                for(const sel of availabilitySelectors)for(const el of document.querySelectorAll(sel)){
                  if(!visible(el)||excluded(el))continue;
                  const t=(el.innerText||'').replace(/\s+/g,' ').trim();
                  if(t&&t.length<130&&/(esgotado|fora de estoque|sem estoque|indisponível|em estoque|disponível|restam\s+\d+|\d+\s+disponíveis|out of stock|in stock|only \d+ left|\d+ available)/i.test(t))availabilityTexts.push(t);
                }
                return {title,imgs:candidates,og,priceTexts,shippingTexts:[...new Set(shippingTexts)].slice(0,8),originTexts:[...new Set(originTexts)].slice(0,5),availabilityTexts:[...new Set(availabilityTexts)].slice(0,8)};
                """)
                found=[];seen=set()
                for raw_url in raw.get('imgs',[]):
                    link=urljoin(driver.current_url,raw_url)
                    if image_url(link) and link not in seen:
                        seen.add(link);found.append(link)
                    if len(found)>=max_imgs:break
                if not found and raw.get('og'):
                    link=urljoin(driver.current_url,raw['og'])
                    if image_url(link):found=[link]
                # Somente preço visível inequívoco em BRL. Preços promocionais/variantes exigem revisão.
                price_candidates=[]
                for label in raw.get('priceTexts',[]):
                    matches=re.findall(r'R\$\s*([0-9][0-9.]*,[0-9]{2})',str(label))
                    for amount in matches:
                        try:
                            value=round(float(amount.replace('.','').replace(',','.')),2)
                            if 0 < value <= 1000000:price_candidates.append(value)
                        except ValueError:pass
                price_candidates=set(price_candidates)
                price_value=next(iter(price_candidates)) if len(price_candidates)==1 else None
                shipping_texts=raw.get('shippingTexts',[])
                shipping_joined=' | '.join(str(x) for x in shipping_texts)
                free=bool(re.search(r'frete\s+gr[aá]tis|envio\s+gr[aá]tis',shipping_joined,re.I))
                shipping_prices=[]
                for text in shipping_texts:
                    for amount in re.findall(r'R\$\s*([0-9][0-9.]*,[0-9]{2})',str(text)):
                        try:shipping_prices.append(round(float(amount.replace('.','').replace(',','.')),2))
                        except ValueError:pass
                if free and shipping_prices:shipping_status,shipping_cost='revisao_frete_contraditorio',None
                elif free:shipping_status,shipping_cost='frete_gratis_observado',0.0
                elif len(set(shipping_prices))==1:shipping_status,shipping_cost='frete_pago_observado',shipping_prices[0]
                else:shipping_status,shipping_cost='frete_nao_confirmado',None
                origin_text=' | '.join(raw.get('originTexts',[]))[:350]
                origins=[]
                for text in raw.get('originTexts',[]):
                    m=re.search(r'(?:enviado de|envia de|envio de|ships from|ship from|origem do envio|local de envio)\s*[:：-]?\s*(Brasil|Brazil|China|Espanha|Spain|Estados Unidos|United States|Portugal|França|France|Alemanha|Germany|Turquia|Turkey)\b',text,re.I)
                    if m:
                        country=m.group(1).lower()
                        countries={'brazil':'Brasil','brasil':'Brasil','china':'China','espanha':'Espanha','spain':'Espanha','estados unidos':'Estados Unidos','united states':'Estados Unidos','portugal':'Portugal','frança':'França','france':'França','alemanha':'Alemanha','germany':'Alemanha','turquia':'Turquia','turkey':'Turquia'}
                        origins.append(countries.get(country,m.group(1)))
                origin=origins[0] if origins and len(set(origins))==1 else None
                avail_text=' | '.join(raw.get('availabilityTexts',[]))[:350]
                if re.search(r'\b(esgotado|fora de estoque|sem estoque|indisponível|out of stock)\b',avail_text,re.I):
                    availability='esgotado'
                elif re.search(r'\b(em estoque|disponível|disponíveis|in stock|available|restam\s+\d+|only \d+ left)\b',avail_text,re.I):
                    availability='disponivel'
                else:availability='nao_confirmado'
                stock_numbers=[]
                for text in raw.get('availabilityTexts',[]):
                    for pattern in (r'\brestam\s+(\d+)\b',r'\b(\d+)\s+disponíveis\b',r'\bonly\s+(\d+)\s+left\b',r'\b(\d+)\s+available\b'):
                        stock_numbers += [int(v) for v in re.findall(pattern,text,re.I)]
                stock_quantity=stock_numbers[0] if stock_numbers and len(set(stock_numbers))==1 and 0<stock_numbers[0]<=1000000 else None
                with self.lock:
                    self.items[u]['origem_envio']=origin or self.items[u].get('origem_envio')
                    self.items[u]['origem_envio_texto']=origin_text
                    self.items[u]['disponibilidade_status']=availability if availability!='nao_confirmado' else self.items[u].get('disponibilidade_status','nao_confirmado')
                    self.items[u]['estoque_observado']=stock_quantity if stock_quantity is not None else self.items[u].get('estoque_observado')
                    self.items[u]['estoque_texto']=avail_text
                    self.items[u]['frete_status']=shipping_status if shipping_status not in ('frete_nao_confirmado','revisao_frete_contraditorio') else self.items[u].get('frete_status') or shipping_status
                    self.items[u]['frete_observado']=shipping_cost if shipping_cost is not None else self.items[u].get('frete_observado')
                    self.items[u]['frete_texto']=shipping_joined[:300]
                    self.items[u]['preco_observado']=price_value if price_value is not None else self.items[u].get('preco_observado')
                    self.items[u]['moeda_observada']='BRL' if self.items[u]['preco_observado'] is not None else None
                    self.items[u]['preco_status']='observado_na_pagina_nao_confirmado' if self.items[u]['preco_observado'] is not None else 'revisao_preco_ambiguo_ou_ausente'
                    self.items[u]['imagens']=found or self.items[u].get('imagens',[])
                    self.items[u]['titulo']=str(raw.get('title',''))[:300]
                    self.items[u]['captura_imagens']='galeria_identificada' if self.items[u]['imagens'] else 'revisao_sem_galeria'
                done+=1;self.logmsg(f'Produto {done}/{min(limit,len(urls))}: {len(found)} imagens; preço observado: {price_value if price_value is not None else "revisão"}; frete: {shipping_status}; origem: {origin or "não confirmada"}; estoque: {stock_quantity if stock_quantity is not None else availability} — {u}')
                if done%5==0:self.save_files()
                if self.stop.wait(2):break
            self.save_files();self.logmsg('Captura concluída. Confira imagens_produtos.csv; URLs podem expirar ou ser bloqueadas.')
        self.run(task)

    def send(self):
        with self.lock:
            produtos=[{'url':u,'categoria':x.get('categoria',''),'titulo':x.get('titulo',''),'imagens':list(x.get('imagens') or [])[:12],'preco_observado':x.get('preco_observado'),'moeda_observada':x.get('moeda_observada'),'preco_status':x.get('preco_status','nao_verificado'),'frete_status':x.get('frete_status','nao_verificado'),'frete_observado':x.get('frete_observado'),'origem_envio':x.get('origem_envio'),'disponibilidade_status':x.get('disponibilidade_status','nao_confirmado'),'estoque_observado':x.get('estoque_observado')} for u,x in self.items.items()]
        urls=[x['url'] for x in produtos]
        if not urls:messagebox.showwarning('Sem URLs','Colete produtos primeiro.');return
        base=self.render.get().strip().rstrip('/');p=urlparse(base)
        if p.scheme!='https' or not p.hostname or p.path not in ('','/'):
            messagebox.showwarning('Render','Informe a URL base HTTPS do Render.');return
        token=self.token.get().strip()
        if not token:messagebox.showwarning('Chave','Informe a chave GARIMPAGEM_API_KEY configurada no Render.');return
        self.store_token_if_opted_in(token)
        try:self.save_preferences()
        except OSError as exc:self.logmsg('Preferências não salvas: '+str(exc)[:150])
        if not messagebox.askyesno('Enviar',f'Enviar {len(urls)} URLs e suas galerias vinculadas para o Neon?\nOs produtos NÃO serão publicados automaticamente.'):
            return
        def task():
            for i in range(0,len(urls),1000):
                payload=json.dumps({'produtos':produtos[i:i+1000],'fornecedor':'AliExpress'}).encode('utf-8')
                req=Request(base+'/api/garimpagem/lotes',data=payload,headers={'X-Garimpagem-Key':token,'Content-Type':'application/json'},method='POST')
                try:
                    with urlopen(req,timeout=60) as res:result=json.loads(res.read().decode('utf-8'))
                except HTTPError as e:
                    detail=e.read(300).decode('utf-8',errors='replace')
                    if e.code==401:raise RuntimeError('HTTP 401: chave de integração inválida ou ausente no Render. Confira GARIMPAGEM_API_KEY. '+detail)
                    if e.code==403:raise RuntimeError('HTTP 403: acesso negado pela API. '+detail)
                    raise RuntimeError(f'HTTP {e.code}: {detail}')
                except URLError as e:raise RuntimeError('Conexão: '+str(e.reason))
                self.logmsg(f'Lote enviado: {result.get("inseridas", "?")} novas; {result.get("duplicadas", "?")} existentes; {result.get("galeriasRecebidas", "?")} galerias recebidas; {result.get("registrosAtualizados", "?")} atualizadas.')
            self.logmsg('Envio de URLs concluído. Atualize cronjob.html para conferir.')
        self.run(task)

    def close(self):
        if self.busy and not messagebox.askyesno('Sair','Uma operação está em andamento. Parar e sair?'):return
        self.stop.set()
        try:self.save_preferences()
        except Exception:pass
        try:self.save_files()
        except Exception:pass
        try:
            if self.driver:self.driver.quit()
        except Exception:pass
        self.root.destroy()

if __name__=='__main__':
    window=tk.Tk();App(window);window.mainloop()
