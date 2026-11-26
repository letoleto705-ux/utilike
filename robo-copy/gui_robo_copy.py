#!/usr/bin/env python3
"""Interface gráfica local do Robô Copy Uti Like — CustomTkinter.

O script original robo_copy.py é o executor. A interface não usa rede para
publicar copies: a geração em Neon é disparada por processo separado, e a
publicação continua dependendo do cronjob no Render.
"""
from __future__ import annotations

import json
import os
import queue
import re
import subprocess
import sys
import tempfile
import threading
import uuid
from pathlib import Path
from tkinter import messagebox
from urllib.request import urlopen
from urllib.parse import urlparse

import customtkinter as ctk
from credenciais_robo_copy import salvar, carregar, configurado, verificar_url

ctk.set_appearance_mode('dark')
ctk.set_default_color_theme('blue')

ROOT = Path(__file__).resolve().parent
PYTHON = ROOT / '.venv' / 'Scripts' / 'python.exe'
ROBO = ROOT / 'robo_copy.py'
MODELO = 'qwen3.5:0.8b'
LOJA = 'https://utilike.onrender.com'
PREFERENCIAS = Path(os.environ.get('LOCALAPPDATA') or str(Path.home())) / 'UtiLike' / 'RoboCopy' / 'preferencias.json'


def validar_url_loja(endereco: str) -> str:
    """Apenas a origem HTTPS, sem credenciais nem caminhos ou parâmetros."""
    texto = str(endereco or '').strip()
    partes = urlparse(texto)
    if (partes.scheme.lower() != 'https' or not partes.hostname
            or partes.username or partes.password or partes.query or partes.fragment
            or partes.path not in ('', '/')):
        raise ValueError('Informe só a URL HTTPS da loja. Ex.: https://utilike.onrender.com (sem /produto.html).')
    return f'https://{partes.netloc.lower()}'


def ler_url_loja() -> str:
    try:
        dados = json.loads(PREFERENCIAS.read_text(encoding='utf-8'))
        return validar_url_loja(dados.get('url_loja', LOJA))
    except (OSError, ValueError, TypeError, AttributeError):
        return LOJA


def gravar_url_loja(url: str) -> None:
    """Salva somente o endereço público; nunca grava senhas do Neon no projeto."""
    url = validar_url_loja(url)
    PREFERENCIAS.parent.mkdir(parents=True, exist_ok=True)
    temporario = PREFERENCIAS.with_suffix('.tmp')
    temporario.write_text(json.dumps({'url_loja': url}, ensure_ascii=False, indent=2), encoding='utf-8')
    temporario.replace(PREFERENCIAS)

DARK = '#0B1120'
CARD = '#121E32'
CARD_LIGHT = '#18263E'
MUTED = '#A2B0C7'
WHITE = '#F1F5FF'
BLUE = '#3B82F6'
ORANGE = '#FF702E'
GREEN = '#29BA88'


class App(ctk.CTk):
    def __init__(self):
        super().__init__()
        self.title('Uti Like  |  Robô Copy • Central de Conteúdo')
        self.geometry('1050x675')
        self.minsize(900, 620)
        self.configure(fg_color=DARK)
        self.process: subprocess.Popen | None = None
        self.thread: threading.Thread | None = None
        self.events: queue.Queue[tuple[str, object]] = queue.Queue()
        self.cancel_file: Path | None = None
        self.cancel_requested = False
        self.processed = 0
        self.total = 0
        self.running = False
        self.visivel = ctk.BooleanVar(value=True)
        self.url_loja = ctk.StringVar(value=ler_url_loja())
        self.tentar_erros = ctk.BooleanVar(value=False)
        self._montar()
        self._atualizar_conexao()
        self.after(120, self._eventos)
        self.protocol('WM_DELETE_WINDOW', self._fechar)

    def _label(self, master, text, size=13, color=WHITE, weight='normal', **opts):
        return ctk.CTkLabel(master, text=text, text_color=color,
                            font=ctk.CTkFont(family='Segoe UI', size=size, weight=weight), **opts)

    def _montar(self):
        self.grid_columnconfigure(0, weight=1)
        self.grid_rowconfigure(1, weight=1)
        header = ctk.CTkFrame(self, fg_color=DARK, corner_radius=0, height=115)
        header.grid(row=0, column=0, sticky='ew', padx=30, pady=(18, 6))
        header.grid_columnconfigure(1, weight=1)
        logo = ctk.CTkFrame(header, width=65, height=65, corner_radius=18, fg_color='#1D3668')
        logo.grid(row=0, column=0, rowspan=2, padx=(0, 18), sticky='w')
        logo.grid_propagate(False)
        self._label(logo, 'UK', 26, ORANGE, 'bold').place(relx=.5, rely=.5, anchor='center')
        self._label(header, 'ROBÔ COPY', 26, WHITE, 'bold').grid(row=0, column=1, sticky='sw', pady=(7, 0))
        self._label(header, 'CENTRAL DE CONTEÚDO  •  UTI LIKE', 12, MUTED).grid(row=1, column=1, sticky='nw', pady=(2, 2))
        self.status_geral = self._label(header, 'PRONTO PARA CONFIGURAR', 11, ORANGE, 'bold')
        self.status_geral.grid(row=0, column=2, rowspan=2, sticky='e', padx=(10, 0))

        central = ctk.CTkFrame(self, fg_color='transparent')
        central.grid(row=1, column=0, sticky='nsew', padx=26, pady=(5, 10))
        central.grid_columnconfigure(0, weight=0)
        central.grid_columnconfigure(1, weight=1)
        central.grid_rowconfigure(0, weight=1)
        left = ctk.CTkScrollableFrame(central, fg_color=CARD, width=300, corner_radius=17)
        left.grid(row=0, column=0, padx=(0, 15), sticky='nsew')
        self._label(left, 'Painel de execução', 18, WHITE, 'bold').pack(anchor='w', padx=22, pady=(22, 3))
        self._label(left, 'Controle local • sem comandos manuais', 11, MUTED).pack(anchor='w', padx=22, pady=(0, 18))

        self.botao_simular = self._botao(left, '▶   Simular produtos', BLUE, self._simular_quantidade)
        self.botao_gravar = self._botao(left, '✦   Gerar copies pendentes', ORANGE, self._gravar_quantidade)
        self.botao_status = self._botao(left, '▤   Consultar progresso', CARD_LIGHT, lambda: self._iniciar('status'))
        self.botao_neon = self._botao(left, '⚙   Configurar Neon', CARD_LIGHT, self._configurar)

        ctk.CTkFrame(left, fg_color='#31405A', height=1).pack(fill='x', padx=20, pady=(19, 12))
        self._label(left, 'Configurações de navegação', 12, MUTED, 'bold').pack(anchor='w', padx=22, pady=(0, 9))
        ctk.CTkSwitch(left, text='Mostrar Google Chrome', variable=self.visivel,
                      progress_color=BLUE, button_color=BLUE,
                      font=ctk.CTkFont(size=12), text_color=WHITE).pack(anchor='w', padx=22, pady=5)
        ctk.CTkSwitch(left, text='Incluir produtos com erro', variable=self.tentar_erros,
                      progress_color=BLUE, button_color=BLUE,
                      font=ctk.CTkFont(size=12), text_color=WHITE).pack(anchor='w', padx=22, pady=5)
        self._label(left, 'Endereço da Uti Like (URL HTTPS)', 11, MUTED, 'bold').pack(
            anchor='w', padx=22, pady=(14, 5))
        self.campo_loja = ctk.CTkEntry(
            left, width=265, height=36, textvariable=self.url_loja,
            placeholder_text=LOJA, fg_color=CARD_LIGHT, border_color='#3A5578',
            font=ctk.CTkFont(size=11))
        self.campo_loja.pack(padx=22, pady=(0, 6))
        self.botao_salvar_loja = ctk.CTkButton(
            left, text='Salvar URL da loja', width=265, height=31,
            fg_color=CARD_LIGHT, hover_color='#263950',
            command=self._salvar_loja)
        self.botao_salvar_loja.pack(padx=22, pady=(0, 5))
        self._label(left, 'O robô abrirá /produto.html?id=... automaticamente.',
                    10, MUTED, wraplength=258).pack(anchor='w', padx=22, pady=(0, 3))
        self._label(left, 'Modelo local', 11, MUTED).pack(anchor='w', padx=22, pady=(14, 1))
        self._label(left, MODELO, 14, WHITE, 'bold').pack(anchor='w', padx=22)

        self.neon_status = self._label(left, 'Neon: verificando…', 11, MUTED)
        self.neon_status.pack(anchor='w', padx=22, pady=(22, 0))
        self.ollama_status = self._label(left, 'IA: não verificada', 11, MUTED)
        self.ollama_status.pack(anchor='w', padx=22, pady=(5, 0))
        ctk.CTkButton(left, text='Verificar IA local', width=265, height=30,
                      fg_color='transparent', border_width=1, border_color='#3D536D',
                      hover_color=CARD_LIGHT, text_color=MUTED,
                      command=self._verificar_ia).pack(padx=22, pady=(12, 0))

        right = ctk.CTkFrame(central, fg_color=CARD, corner_radius=17)
        right.grid(row=0, column=1, sticky='nsew')
        right.grid_columnconfigure(0, weight=1)
        right.grid_rowconfigure(2, weight=1)
        topline = ctk.CTkFrame(right, fg_color='transparent')
        topline.grid(row=0, column=0, sticky='ew', padx=20, pady=(20, 10))
        topline.grid_columnconfigure(0, weight=1)
        self._label(topline, 'Acompanhamento', 18, WHITE, 'bold').grid(row=0, column=0, sticky='w')
        ctk.CTkButton(topline, text='Limpar histórico', width=124, height=29,
                      fg_color=CARD_LIGHT, hover_color='#243A58', text_color=MUTED,
                      command=self._limpar).grid(row=0, column=1, sticky='e')
        info = ctk.CTkFrame(right, fg_color=CARD_LIGHT, corner_radius=10)
        info.grid(row=1, column=0, sticky='ew', padx=20, pady=(0, 12))
        
        for col in (0, 1, 2):
            info.grid_columnconfigure(col, weight=1)
        self.info_processados = self._info(info, 0, 'CONCLUÍDOS NESTA EXECUÇÃO', '0')
        self.info_total = self._info(info, 1, 'PRODUTOS NA FILA', '—')
        self.info_modo = self._info(info, 2, 'MODO', 'Aguardando')

        self.console = ctk.CTkTextbox(right, fg_color='#0C1423', text_color='#D6E1F3',
                                      corner_radius=12, border_width=0,
                                      font=ctk.CTkFont(family='Consolas', size=12),
                                      wrap='word', activate_scrollbars=True)
        self.console.grid(row=2, column=0, sticky='nsew', padx=20, pady=(0, 14))
        self.console.insert('end', '[ UTI LIKE ]  Painel pronto.\n\n'
                           '• Simulação: nenhuma gravação no Neon.\n'
                           '• Gravação: exige confirmação GRAVAR.\n'
                           '• Publicação: depende do Cronjob do Render.\n')
        self.console.configure(state='disabled')
        rodape = ctk.CTkFrame(right, fg_color='transparent')
        rodape.grid(row=3, column=0, sticky='ew', padx=20, pady=(0, 18))
        rodape.grid_columnconfigure(0, weight=1)
        self.progress = ctk.CTkProgressBar(rodape, height=10, fg_color='#25344C', progress_color=GREEN)
        self.progress.grid(row=0, column=0, sticky='ew', pady=(0, 10))
        self.progress.set(0)
        self.mensagem = self._label(rodape, 'Aguardando execução', 11, MUTED)
        self.mensagem.grid(row=1, column=0, sticky='w')
        self.botao_parar = ctk.CTkButton(rodape, text='Parar', height=33, width=115,
                                        fg_color='#6B303A', hover_color='#8F3B46',
                                        command=self._parar, state='disabled')
        self.botao_parar.grid(row=1, column=1, sticky='e', padx=(12, 0))
        self._label(self, 'As descrições são produzidas no computador. O banco recebe apenas as copies autorizadas.',
                    11, MUTED).grid(row=2, column=0, sticky='w', padx=31, pady=(0, 13))

    def _info(self, master, col, titulo, valor):
        box = ctk.CTkFrame(master, fg_color='transparent')
        box.grid(row=0, column=col, sticky='ew', padx=14, pady=12)
        self._label(box, titulo, 9, MUTED, 'bold', anchor='w').pack(fill='x')
        widget = self._label(box, valor, 18, WHITE, 'bold', anchor='w')
        widget.pack(fill='x', pady=(4, 0))
        return widget

    def _botao(self, parent, text, color, cmd):
        b = ctk.CTkButton(parent, text=text, width=265, height=43,
                          corner_radius=10, fg_color=color,
                          hover_color=('#E15D26' if color == ORANGE else '#2B64BF' if color == BLUE else '#263950'),
                          font=ctk.CTkFont(size=13, weight='bold'), command=cmd)
        b.pack(padx=22, pady=5)
        return b

    def _registro(self, linha):
        if not self.winfo_exists(): return
        self.console.configure(state='normal')
        self.console.insert('end', str(linha).rstrip() + '\n')
        self.console.see('end')
        self.console.configure(state='disabled')

    def _limpar(self):
        self.console.configure(state='normal')
        self.console.delete('1.0', 'end')
        self.console.configure(state='disabled')

    def _atualizar_conexao(self):
        self.neon_status.configure(text='Neon: conexão protegida configurada' if configurado()
                                   else 'Neon: configurar conexão',
                                   text_color=GREEN if configurado() else ORANGE)

    def _configurar(self):
        if self._ocupado():
            messagebox.showinfo('Robô Copy', 'Aguarde o encerramento da execução atual.', parent=self)
            return
        win = ctk.CTkToplevel(self)
        win.title('Configurar conexão Neon')
        win.geometry('580x315')
        win.resizable(False, False)
        win.configure(fg_color=DARK)
        win.transient(self)
        win.grab_set()
        self._label(win, 'Conexão segura com Neon', 20, WHITE, 'bold').pack(anchor='w', padx=24, pady=(24, 8))
        self._label(win, 'Cole a DATABASE_URL da branch desejada. Ela não será gravada no Git nem mostrada em logs.',
                    12, MUTED, wraplength=530, justify='left').pack(anchor='w', padx=24)
        campo = ctk.CTkEntry(win, width=530, height=43, show='•', placeholder_text='postgresql://…',
                             fg_color=CARD_LIGHT, border_color='#3A5578')
        campo.pack(padx=24, pady=(20, 8))
        exibir = ctk.BooleanVar(value=False)
        def mostrar():
            campo.configure(show='' if exibir.get() else '•')
        ctk.CTkCheckBox(win, text='Mostrar conexão enquanto digito', variable=exibir,
                        command=mostrar, text_color=MUTED, fg_color=BLUE).pack(anchor='w', padx=26)
        self._label(win, 'A credencial fica criptografada pelo Windows (DPAPI), fora do repositório.',
                    11, MUTED).pack(anchor='w', padx=24, pady=(15, 5))
        def confirmar():
            # Confirma que a URL funciona ANTES de armazenar a credencial.
            # SELECT nao altera dados ou publica copies.
            try:
                url = verificar_url(campo.get())
            except ValueError as exc:
                messagebox.showerror('Conexão Neon', str(exc), parent=win)
                return
            try:
                import psycopg
                with psycopg.connect(url, connect_timeout=12) as conn:
                    tabela = conn.execute(
                        "SELECT to_regclass('public.robo_copy_produtos') IS NOT NULL"
                    ).fetchone()[0]
                if not tabela:
                    messagebox.showerror(
                        'Tabela do Robô Copy não encontrada',
                        'Consegui acessar o Neon, mas não encontrei a tabela '
                        'public.robo_copy_produtos nesta branch/banco. '
                        'Confira se a connection string aponta para a branch correta.',
                        parent=win,
                    )
                    return
            except Exception:
                # Mensagens de libpq/psycopg podem incluir trechos confidenciais da URL.
                messagebox.showerror(
                    'Conexão Neon não validada',
                    'Não foi possível estabelecer a conexão ou consultar a tabela. '
                    'Confira senha, branch, banco, conexão com a internet e permissões. '
                    'Nenhuma copy foi gravada. Não envie sua senha em prints.',
                    parent=win,
                )
                return
            try:
                salvar(url)
                campo.delete(0, 'end')
                self._atualizar_conexao()
                self._registro('[CONFIG] Neon validado: tabela robo_copy_produtos encontrada. Credencial salva no Windows; nenhuma copy gravada.')
                messagebox.showinfo(
                    'Neon conectado',
                    'Conexão validada e tabela encontrada. A credencial foi salva neste computador. '
                    'Nenhuma copy foi enviada ainda. Use Consultar progresso para verificar o banco.',
                    parent=win,
                )
                win.destroy()
            except Exception:
                messagebox.showerror('Conexão Neon',
                    'Consegui acessar o Neon, mas não foi possível salvar a credencial no Windows.', parent=win)
        ctk.CTkButton(win, text='Salvar conexão', fg_color=BLUE, hover_color='#2B64BF',
                      command=confirmar, width=155).pack(anchor='e', padx=24, pady=(4, 0))
        campo.focus_set()

    def _ocupado(self):
        return self.running

    def _verificar_ia(self):
        if self._ocupado(): return
        self.ollama_status.configure(text='IA: verificando…', text_color=MUTED)
        def worker():
            try:
                with urlopen('http://127.0.0.1:11434/api/tags', timeout=7) as r:
                    obj=json.load(r)
                nomes=[x.get('name','') for x in obj.get('models', [])]
                if not any(n == MODELO or n.startswith(MODELO + ':') for n in nomes):
                    self.events.put(('ia', (False, f'Modelo não encontrado: {MODELO}')))
                else:
                    self.events.put(('ia', (True, f'IA disponível: {MODELO}')))
            except Exception:
                self.events.put(('ia', (False, 'Ollama local não respondeu')))
        threading.Thread(target=worker, daemon=True).start()

    def _salvar_loja(self):
        if self._ocupado():
            return
        try:
            base = validar_url_loja(self.url_loja.get())
            gravar_url_loja(base)
        except (ValueError, OSError) as exc:
            messagebox.showerror('URL da Uti Like', str(exc), parent=self)
            return
        self.url_loja.set(base)
        self._registro('[CONFIG] URL da loja salva: ' + base)

    def _simular_quantidade(self):
        """Permite simular qualquer quantidade, sem mexer no Neon.

        O comando de simulação do executor aceita --limite N ou nenhum limite.
        """
        if self._ocupado():
            return
        janela = ctk.CTkInputDialog(
            title='Simular produtos — Uti Like',
            text=('Quantos produtos deseja simular?\n\n'
                  'Exemplos: 2, 5, 10, 50 ou 100.\n'
                  'Digite TODOS para percorrer o catálogo inteiro.\n\n'
                  'Simular não grava no Neon.'))
        entrada = janela.get_input()
        if entrada is None:
            return
        entrada = entrada.strip()
        if entrada.upper() in ('TODOS', 'TUDO'):
            if not messagebox.askyesno(
                'Simular todo o catálogo',
                'A simulação percorrerá todos os produtos ativos e poderá levar bastante tempo.\n'
                'Nenhuma copy será gravada no Neon. Deseja continuar?', parent=self):
                return
            limite = None
        elif entrada.isascii() and entrada.isdecimal() and int(entrada) >= 1:
            limite = int(entrada)
        else:
            messagebox.showwarning('Quantidade inválida',
                'Digite um número inteiro maior que zero (por exemplo, 5) ou TODOS.', parent=self)
            return
        self._iniciar('simular', limite=limite)

    def _gravar_quantidade(self):
        """Escolhe um lote pequeno para o primeiro teste real no Neon.

        O motor Python já suporta --limite para gravação; esta interface só
        expõe essa capacidade sem alterar o algoritmo de publicação.
        """
        if self._ocupado():
            return
        janela = ctk.CTkInputDialog(
            title='Gravar copies no Neon — Uti Like',
            text=('Quantos produtos pendentes deseja GRAVAR no Neon?\n\n'
                  'Para o primeiro teste, digite 1.\n'
                  'Você também pode informar 2, 5, 10, 50 etc.\n'
                  'Digite TODOS para executar o catálogo inteiro.\n\n'
                  'A conexão será com a branch configurada na tela Neon.'))
        entrada = janela.get_input()
        if entrada is None:
            return
        entrada = entrada.strip()
        if entrada.upper() in ('TODOS', 'TUDO'):
            if not messagebox.askyesno(
                'Confirmar catálogo inteiro',
                'TODOS os produtos pendentes poderão ser processados e gravados no Neon.\n'
                'Recomenda-se validar primeiro um lote de 1 produto.\n\n'
                'Deseja realmente continuar?', parent=self):
                return
            limite = None
        elif entrada.isascii() and entrada.isdecimal() and int(entrada) >= 1:
            limite = int(entrada)
        else:
            messagebox.showwarning(
                'Quantidade inválida',
                'Digite um número inteiro maior que zero ou TODOS.', parent=self)
            return
        self._iniciar('gravar', limite=limite)

    def _iniciar(self, modo, limite=None):
        if self._ocupado(): return
        if not PYTHON.is_file() or not ROBO.is_file():
            messagebox.showerror('Arquivos não encontrados',
                'Confira robo-copy\\.venv\\Scripts\\python.exe e robo-copy\\robo_copy.py.', parent=self)
            return
        if modo != 'status':
            try:
                origem = validar_url_loja(self.url_loja.get())
                gravar_url_loja(origem)
                self.url_loja.set(origem)
            except (ValueError, OSError) as exc:
                messagebox.showerror('URL da loja', str(exc), parent=self)
                return
        else:
            origem = LOJA  # consulta de status não navega na loja
        if not configurado():
            messagebox.showinfo('Conexão necessária',
                'Primeiro configure a DATABASE_URL do Neon com o botão "Configurar Neon".', parent=self)
            self._configurar()
            return
        if modo == 'gravar':
            dialogo = ctk.CTkInputDialog(
                text='Atenção: grava copies no Neon configurado.\n\n'
                     'Lote solicitado: ' + (str(limite) if limite is not None else 'TODOS') + '\n'
                     'Digite GRAVAR para autorizar:',
                title='Confirmar gravação no Neon')
            resposta = dialogo.get_input()
            if resposta != 'GRAVAR':
                self._registro('[SEGURANÇA] Gravação cancelada. Nenhum processo iniciado.')
                return
        self.processed, self.total = 0, 0
        self.info_processados.configure(text='0')
        self.info_total.configure(text='—')
        self.info_modo.configure(text={'simular':'Simulação','gravar':'Gravação','status':'Consulta'}[modo])
        self.progress.set(0)
        self.cancel_requested = False
        self.cancel_file = Path(tempfile.gettempdir()) / f'uti_like_robo_copy_cancel_{uuid.uuid4().hex}.flag'
        self._set_busy(True)
        self._registro('')
        self._registro(f'[INÍCIO] {modo.upper()} • IA {MODELO}')
        if modo == 'simular':
            self._registro('[SIMULAÇÃO] Quantidade solicitada: ' + (str(limite) if limite is not None else 'TODOS'))
        elif modo == 'gravar':
            self._registro('[GRAVAÇÃO] Lote autorizado: ' + (str(limite) if limite is not None else 'TODOS'))
        self.thread = threading.Thread(target=self._worker, args=(modo, self.cancel_file, self.visivel.get(), self.tentar_erros.get(), limite, origem), daemon=True)
        self.thread.start()

    def _set_busy(self, busy):
        self.running = busy
        state = 'disabled' if busy else 'normal'
        for b in (self.botao_simular, self.botao_gravar, self.botao_status, self.botao_neon):
            b.configure(state=state)
        self.botao_salvar_loja.configure(state=state)
        self.campo_loja.configure(state=state)
        self.botao_parar.configure(state='normal' if busy else 'disabled', text='Parar')
        self.status_geral.configure(text='EM EXECUÇÃO' if busy else 'PRONTO',
                                    text_color=ORANGE if busy else GREEN)
        self.mensagem.configure(text='Processamento em andamento…' if busy else 'Aguardando execução')

    def _worker(self, modo, cancel_file, visivel, tentar_erros, limite, origem):
        rc = 1
        try:
            url = carregar()
            if modo != 'status':
                with urlopen('http://127.0.0.1:11434/api/tags', timeout=8) as r:
                    obj=json.load(r)
                nomes = [x.get('name','') for x in obj.get('models', [])]
                if MODELO not in nomes:
                    raise RuntimeError(f'Modelo {MODELO} não encontrado no Ollama. Execute ollama pull {MODELO}.')
            env=os.environ.copy()
            env['DATABASE_URL']=url
            env['ROBO_COPY_MODELO']=MODELO
            env['UTI_LIKE_BASE_URL']=origem
            env['OLLAMA_HOST']='http://localhost:11434'
            env.pop('ROBO_COPY_PERMITIR_ESCRITA', None)
            args=[str(PYTHON), '-u', str(ROBO), '--modo', modo, '--modelo', MODELO]
            if modo == 'gravar':
                env['ROBO_COPY_PERMITIR_ESCRITA']='SIM'
                if tentar_erros: args.append('--tentar-erros')
            if modo in ('simular', 'gravar') and limite is not None: args += ['--limite', str(limite)]
            if modo != 'status':
                args += ['--navegador','chrome', '--base', origem, '--fotos','2', '--cancel-file', str(cancel_file)]
                if visivel: args.append('--visivel')
            flags=getattr(subprocess,'CREATE_NO_WINDOW',0)
            self.process=subprocess.Popen(args, cwd=str(ROOT), env=env,
                stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                text=True, encoding='utf-8', errors='replace', bufsize=1,
                creationflags=flags)
            self.events.put(('log', '[PROCESSO] Google Chrome e modelo sob controle do robô.'))
            if modo != 'status': self.events.put(('log', '[LOJA] Origem configurada: ' + origem))
            if self.process.stdout:
                for linha in self.process.stdout:
                    self.events.put(('log',linha.rstrip('\r\n')))
            rc = self.process.wait()
        except Exception as exc:
            # Exceptions não devem ecoar a conexão PostgreSQL no log.
            self.events.put(('log', f'[ERRO] {type(exc).__name__}: Não foi possível iniciar ou concluir o processo.'))
            self.events.put(('log', '[DICA] Verifique Neon, Ollama, arquivos Python e permissões de execução.'))
        finally:
            try: cancel_file.unlink(missing_ok=True)
            except OSError: pass
            self.events.put(('fim', rc))

    def _parar(self):
        if not self._ocupado(): return
        if not self.cancel_requested:
            self.cancel_requested = True
            try:
                if self.cancel_file: self.cancel_file.write_text('parar', encoding='ascii')
            except OSError:
                messagebox.showerror('Parada', 'Não foi possível criar sinal de cancelamento.', parent=self)
                return
            self.mensagem.configure(text='Parada solicitada; terminando o produto atual…')
            self.botao_parar.configure(text='Forçar parada')
            self._registro('[PARADA] Aguardando conclusão do produto atual para encerrar com segurança.')
        else:
            if messagebox.askyesno('Forçar parada',
                'Forçar agora poderá deixar o último produto em "processando" por até 90 minutos.\n'
                'Deseja interromper imediatamente?', parent=self):
                p = self.process
                if p and p.poll() is None:
                    p.terminate()
                    self._registro('[PARADA] Processo encerrado à força. Confira o status no Neon.')

    def _eventos(self):
        try:
            for _ in range(90):
                tipo, val = self.events.get_nowait()
                if tipo == 'log':
                    texto = re.sub(r'postgres(?:ql)?://[^\s\"\']+', '[DATABASE_URL_OCULTA]', str(val), flags=re.I)
                    self._registro(texto)
                    m=re.search(r'Produtos na execução:\s*(\d+)', texto)
                    if m:
                        self.total=int(m.group(1)); self.info_total.configure(text=str(self.total))
                    m=re.search(r'Progresso\s+(\d+)/(\d+)',texto)
                    if m:
                        self.processed=int(m.group(1)); self.total=int(m.group(2))
                        self.info_processados.configure(text=str(self.processed))
                        self.info_total.configure(text=str(self.total))
                        if self.total:self.progress.set(min(1.0, self.processed/self.total))
                elif tipo == 'ia':
                    ok, texto = val
                    self.ollama_status.configure(text=texto, text_color=GREEN if ok else ORANGE)
                    self._registro('[IA] ' + texto)
                elif tipo == 'fim':
                    self.process=None
                    self.thread=None
                    self._set_busy(False)
                    self.mensagem.configure(text='Concluído' if val==0 else 'Encerrado • verifique os registros')
                    self._registro('[FIM] ' + ('Concluído.' if val==0 else f'Código de saída: {val}'))
        except queue.Empty:
            pass
        if self.winfo_exists(): self.after(120, self._eventos)

    def _fechar(self):
        if self._ocupado():
            messagebox.showinfo('Robô Copy em execução',
                'Peça a parada pelo botão "Parar" antes de fechar esta janela.', parent=self)
            return
        self.destroy()


if __name__ == '__main__':
    App().mainloop()
