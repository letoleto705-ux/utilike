# -*- coding: utf-8 -*-
"""
garimpagem.py - Loja Tech
Garimpagem interativa de links de produtos: automação + ação humana.

Sempre que a automação encontrar QUALQUER problema (captcha, login, bloqueio,
erro de carregamento, página em branco, fim de conteúdo, Chrome travado...),
ela PAUSA, avisa no console/tela/som e ESPERA você resolver na janela do
Chrome. Quando terminar, clique em "Continuar". Ou clique em "Parar e salvar"
para encerrar guardando o que já foi coletado.

Instalação (uma vez):
    pip install nicegui selenium webdriver-manager

Execução:
    python garimpagem.py
O painel abre em http://localhost:8080
"""

import json
import os
import queue
import random
import re
import shutil
import socket
import subprocess
import threading
import time
import unicodedata
from datetime import datetime
from pathlib import Path
from urllib.parse import parse_qsl, quote, quote_plus, urlencode, urlparse, urlunparse

from nicegui import app, run, ui
from selenium import webdriver
from selenium.common.exceptions import (
    NoSuchWindowException,
    TimeoutException,
)
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service

# ----------------------------------------------------------------------------
# CONFIGURAÇÕES
# ----------------------------------------------------------------------------
BASE_DIR = Path(__file__).resolve().parent if "__file__" in globals() else Path.cwd()
ARQUIVO_SAIDA = BASE_DIR / "links_garimpados.txt"
ARQUIVO_RESERVA = Path.home() / "links_garimpados.txt"
ARQUIVO_CSV_NOME = "links_por_categoria.csv"
ARQUIVO_CONFIG = BASE_DIR / "config_garimpagem.txt"

MODELO_CONFIG = """# ============================================================
#  CONFIGURAÇÃO DA GARIMPAGEM - Loja Tech
#  Linhas que começam com # são ignoradas (comentários).
#  Para desativar um site, coloque # na frente da linha.
# ============================================================

# ---------- SITES SALVOS (NOME = ENDEREÇO) ----------
# Pode colocar quantos quiser, um por linha.
AliExpress = https://pt.aliexpress.com/
Americanas = https://www.americanas.com.br/
#Shopee = https://shopee.com.br/
#MercadoLivre = https://www.mercadolivre.com.br/
#Magalu = https://www.magazineluiza.com.br/

# ---------- PADRÕES AO ABRIR O PROGRAMA ----------
QUANTIDADE = 50
SOMENTE_PRODUTOS = sim
# CATEGORIAS = todas | nenhuma | lista separada por vírgula (sem vírgula dentro do nome)
# Exemplo: CATEGORIAS = Brinquedos, Cama mesa e banho, Acessórios para celular
CATEGORIAS = todas
"""
# Perfil exclusivo do robô (guarda login/cookies entre execuções e NÃO conflita
# com o seu Chrome do dia a dia).
PERFIL_CHROME = Path.home() / "garimpagem_chrome_profile"
# Onde fica o perfil do SEU Chrome do dia a dia (origem da cópia)
CHROME_ORIGINAL = Path(os.environ.get("LOCALAPPDATA", str(Path.home()))) / "Google" / "Chrome" / "User Data"
# Pastas de cache que não precisam ser copiadas (deixam a cópia muito mais rápida)
PASTAS_IGNORADAS_CLONE = (
    "Cache", "Code Cache", "GPUCache", "GraphiteDiskCache", "DawnGraphiteCache",
    "DawnWebGPUCache", "ShaderCache", "GrShaderCache", "Service Worker", "CacheStorage",
    "ScriptCache", "Crashpad", "Media Cache", "blob_storage", "optimization_guide*",
)

PORTA_DEBUG = 9222                # porta de conexão com o Chrome normal
TEMPO_MAX_EXTRACAO = 15 * 60      # segundos de trabalho (o tempo em pausa não conta)
LIMITE_CICLOS_SEM_NOVOS = 8       # ciclos sem links novos => pausa e pergunta
MAX_RECUPERACOES = 3              # reinícios automáticos do Chrome se ele cair
MAX_LINHAS_LOG = 500

# Parâmetros de rastreio removidos dos links
PARAMS_RASTREIO = {
    "fbclid", "gclid", "msclkid", "igshid", "ref", "ref_", "spm", "scm",
    "pvid", "algo_pvid", "algo_exp_id", "aem_p4p_detail", "pdp_npi", "gps-id",
    "mp", "tag", "cid", "sid", "smtt", "af_click_lookback", "sp_atk",
    "xptdk", "dchild", "keywords", "qid", "sr", "sprefix", "crid",
}
PREFIXOS_RASTREIO = ("utm_", "aff_", "af_", "pf_rd_", "pd_rd_", "algo_", "gad_")

# Domínios em que a query string nunca é necessária para identificar o produto
DOMINIOS_SEM_QUERY = (
    "shopee.", "aliexpress.", "shein.", "magazineluiza.", "magalu.",
    "mercadolivre.", "amazon.", "kabum.", "americanas.", "casasbahia.",
    "temu.", "submarino.", "pontofrio.",
)

# Padrões que indicam página de PRODUTO, por domínio
PADROES_PRODUTO = [
    ("shopee.", re.compile(r"-i\.\d+\.\d+")),
    ("aliexpress.", re.compile(r"/item/\d+")),
    ("shein.", re.compile(r"-p-\d+")),
    ("magazineluiza.", re.compile(r"/p/[a-z0-9]+/?")),
    ("magalu.", re.compile(r"/p/[a-z0-9]+/?")),
    ("mercadolivre.", re.compile(r"(MLB-?\d+|/p/MLB)")),
    ("amazon.", re.compile(r"(/dp/[A-Z0-9]{10}|/gp/product/[A-Z0-9]{10})")),
    ("kabum.", re.compile(r"/produto/\d+")),
    ("americanas.", re.compile(r"/produto/")),
    ("submarino.", re.compile(r"/produto/")),
    ("casasbahia.", re.compile(r"/p/|/produto/")),
    ("temu.", re.compile(r"-g-\d+")),
]
# Heurística genérica (domínios fora da lista acima): ignora páginas "de sistema"
IGNORAR_CAMINHOS = (
    "login", "signin", "cadastro", "register", "cart", "carrinho", "checkout",
    "help", "ajuda", "faq", "politica", "privacy", "termos", "terms", "account",
    "minha-conta", "wishlist", "favoritos", "atendimento", "contato",
)

# ----------------------------------------------------------------------------
# DETECÇÃO DE PROBLEMAS (qualquer um destes faz a automação PAUSAR)
# ----------------------------------------------------------------------------
FRASES_BLOQUEIO = (
    "verify you are human", "verify you're human", "are you a human",
    "i'm not a robot", "i’m not a robot", "não sou um robô", "nao sou um robo",
    "verifique que você é humano", "verifique se você é humano",
    "confirme que você é humano", "unusual traffic", "tráfego incomum",
    "trafego incomum", "access denied", "acesso negado", "just a moment",
    "checking your browser", "verificando seu navegador", "verificando se você é humano",
    "slide to verify", "arraste o controle", "arraste para verificar",
    "press & hold", "pressione e segure", "too many requests",
    "muitas solicitações", "muitas requisições", "temporarily blocked",
    "bloqueado temporariamente", "security check", "verificação de segurança",
    "captcha", "robot or human", "you have been blocked", "você foi bloqueado",
    "a verificação falhou", "tente novamente mais tarde", "verification failed",
    "try again later",
)
FRASES_ERRO_CARREGAMENTO = (
    "this site can’t be reached", "this site can't be reached",
    "não foi possível acessar esse site", "err_connection", "err_name_not_resolved",
    "err_timed_out", "err_internet_disconnected", "err_network_changed",
    "aw, snap", "ah, não!", "sem conexão com a internet", "you are offline",
    "esta página não está funcionando", "this page isn’t working",
    "this page isn't working", "502 bad gateway", "504 gateway", "service unavailable",
    "http error 5",
)
PARTES_URL_LOGIN = (
    "/login", "/signin", "/sign-in", "/buyer/login", "/account/login",
    "/user/login", "authwall", "passport.", "/entrar", "/identificacao",
)

JS_DIAGNOSTICO = r"""
const corpo = document.body ? document.body.innerText : '';
const desafio = Array.from(document.querySelectorAll('iframe')).some(f => {
  const s = (f.src || '').toLowerCase();
  if (!/(recaptcha|hcaptcha|captcha|geetest|challenges\.cloudflare|datadome|perimeterx|arkoselabs)/.test(s)) return false;
  const r = f.getBoundingClientRect();
  const st = window.getComputedStyle(f);
  return r.width >= 250 && r.height >= 70 && st.visibility !== 'hidden' && st.display !== 'none' && st.opacity !== '0';
});
return {
  texto: corpo.toLowerCase().slice(0, 8000),
  tamanho: corpo.length,
  titulo: (document.title || '').toLowerCase(),
  url: location.href.toLowerCase(),
  pronto: document.readyState,
  desafio: desafio
};
"""

JS_PROXIMA_PAGINA = r"""
const visivel = e => e && e.offsetParent !== null && !e.disabled && e.getAttribute('aria-disabled') !== 'true';
const norm = t => (t || '').replace(/\s+/g, ' ').trim().toLowerCase();
const cand = Array.from(document.querySelectorAll('a, button'));
const alvo = cand.find(e => {
  if (!visivel(e)) return false;
  const rel = (e.getAttribute('rel') || '').toLowerCase();
  const t = norm(e.innerText || e.getAttribute('aria-label') || e.getAttribute('title'));
  return rel.includes('next')
    || /^(próxima|proxima|próximo|proximo|seguinte|next|ver mais|carregar mais|mostrar mais|ver mais produtos)( ?[›»>])?$/.test(t)
    || t === '›' || t === '»' || t === '>';
});
if (alvo) { alvo.scrollIntoView({block: 'center'}); alvo.click(); return true; }
return false;
"""

JS_COLETAR_LINKS = (
    "return Array.from(document.querySelectorAll('a[href]'))"
    ".map(a => a.href).filter(h => h && h.startsWith('http'));"
)

JS_ROLAR = r"""
const passo = Math.max(250, Math.floor(window.innerHeight * arguments[0]));
const alturaTotal = document.documentElement.scrollHeight;
const noFim = (window.innerHeight + window.scrollY) >= (alturaTotal - 60);
if (noFim) { window.scrollTo({top: alturaTotal, behavior: 'smooth'}); }
else { window.scrollBy({top: passo, behavior: 'smooth'}); }
"""


# ----------------------------------------------------------------------------
# FUNÇÕES AUXILIARES (links)
# ----------------------------------------------------------------------------
def criar_config_exemplo():
    """Cria o arquivo de configuração com um modelo, se ele ainda não existir."""
    try:
        if not ARQUIVO_CONFIG.exists():
            ARQUIVO_CONFIG.write_text(MODELO_CONFIG, encoding="utf-8")
    except Exception:
        pass


def carregar_config() -> dict:
    """Lê config_garimpagem.txt. Retorna sites [(nome, url)], quantidade, somente_produtos, categorias, erros."""
    cfg = {"sites": [], "quantidade": None, "somente_produtos": None, "categorias": None, "erros": []}
    if not ARQUIVO_CONFIG.exists():
        return cfg
    try:
        texto = ARQUIVO_CONFIG.read_text(encoding="utf-8-sig")
    except UnicodeDecodeError:
        texto = ARQUIVO_CONFIG.read_text(encoding="cp1252", errors="ignore")
    except Exception as e:
        cfg["erros"].append(f"Não consegui ler o arquivo: {e}")
        return cfg

    for n, linha in enumerate(texto.splitlines(), 1):
        linha = linha.strip()
        if not linha or linha.startswith("#") or "=" not in linha:
            continue
        chave, valor = linha.split("=", 1)
        chave = chave.strip()
        valor = re.split(r"\s+#", valor, maxsplit=1)[0].strip()  # comentário no fim da linha
        k = sem_acentos(chave).upper().replace(" ", "_")
        if k == "QUANTIDADE":
            try:
                cfg["quantidade"] = max(1, int(valor))
            except ValueError:
                cfg["erros"].append(f"Linha {n}: QUANTIDADE inválida.")
        elif k == "SOMENTE_PRODUTOS":
            cfg["somente_produtos"] = sem_acentos(valor).lower() in ("sim", "s", "true", "1", "yes")
        elif k == "CATEGORIAS":
            v = sem_acentos(valor).lower().strip()
            if v in ("todas", "todos", "all"):
                cfg["categorias"] = "todas"
            elif v in ("", "nenhuma", "nenhum", "none"):
                cfg["categorias"] = []
            else:
                cfg["categorias"] = [c.strip() for c in valor.split(",") if c.strip()]
        else:
            url = normalizar_url_digitada(valor)
            if chave and url_parece_valida(url):
                cfg["sites"].append((chave, url))
            else:
                cfg["erros"].append(f"Linha {n}: endereço inválido para '{chave}'.")
    return cfg


def normalizar_url_digitada(url: str) -> str:
    url = (url or "").strip()
    if not url:
        return ""
    if not re.match(r"^https?://", url, re.IGNORECASE):
        url = "https://" + url
    return url


def url_parece_valida(url: str) -> bool:
    try:
        p = urlparse(url)
        return p.scheme in ("http", "https") and "." in p.netloc and " " not in url
    except Exception:
        return False


def limpar_link(url: str) -> str:
    """Remove rastreio, fragmentos e parâmetros desnecessários."""
    try:
        p = urlparse(url.strip())
        if p.scheme not in ("http", "https") or not p.netloc:
            return ""
        host = p.netloc.lower()
        if any(d in host for d in DOMINIOS_SEM_QUERY):
            query = ""
        else:
            pares = [
                (k, v)
                for k, v in parse_qsl(p.query, keep_blank_values=False)
                if k.lower() not in PARAMS_RASTREIO
                and not k.lower().startswith(PREFIXOS_RASTREIO)
            ]
            query = urlencode(pares)
        caminho = p.path.rstrip("/") if len(p.path) > 1 else p.path
        return urlunparse((p.scheme, p.netloc, caminho, "", query, ""))
    except Exception:
        return ""


def parece_produto(url: str, host_base: str) -> bool:
    """Heurística para decidir se o link é de um produto."""
    try:
        p = urlparse(url)
        host = p.netloc.lower()
        for dominio, regex in PADROES_PRODUTO:
            if dominio in host:
                return bool(regex.search(url))
        if host_base and host_base not in host:
            return False
        caminho = p.path.lower().strip("/")
        if len(caminho) < 8:
            return False
        if any(parte in caminho for parte in IGNORAR_CAMINHOS):
            return False
        return True
    except Exception:
        return False


# (nome mostrado na tela, termo usado na busca do site)
CATEGORIAS = [
    ("Acessórios para celular", "acessorios para celular"),
    ("Fones de ouvido e bluetooth", "fone de ouvido bluetooth"),
    ("Carregadores e cabos", "carregador cabo celular"),
    ("Smartwatch e relógios inteligentes", "smartwatch"),
    ("Caixas de som", "caixa de som bluetooth"),
    ("Câmeras e segurança", "camera de seguranca wifi"),
    ("Informática e periféricos", "mouse teclado gamer"),
    ("Games e acessórios", "acessorios games controle"),
    ("Iluminação LED e inteligente", "luminaria led"),
    ("Gadgets e eletrônicos", "gadgets eletronicos"),
    ("Tecnologia (geral)", "tecnologia"),
    ("Cama, mesa e banho", "cama mesa e banho"),
    ("Casa e decoração", "decoracao casa"),
    ("Utilidades domésticas", "utilidades domesticas"),
    ("Cozinha", "utensilios de cozinha"),
    ("Brinquedos", "brinquedos"),
    ("Bebês e infantil", "produtos para bebe"),
    ("Beleza e cuidados pessoais", "beleza cuidados pessoais"),
    ("Saúde e bem-estar", "saude e bem estar"),
    ("Pet shop", "acessorios pet"),
    ("Automotivo", "acessorios automotivos"),
    ("Ferramentas", "ferramentas"),
    ("Esporte e lazer", "esporte e lazer"),
    ("Papelaria e escritório", "papelaria escritorio"),
    ("Moda e acessórios", "moda acessorios"),
]


def sem_acentos(texto: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", texto) if unicodedata.category(c) != "Mn")


def montar_url_busca(url_atual: str, termo: str):
    """Monta a URL de busca do site que está aberto. Retorna None se o site não for conhecido."""
    try:
        p = urlparse(url_atual)
        host = p.netloc.lower()
        base = f"{p.scheme}://{p.netloc}"
        termo = sem_acentos(termo.strip().lower())
        slug = re.sub(r"[^a-z0-9]+", "-", termo).strip("-")
        q_mais = quote_plus(termo)
        q_pct = quote(termo)
        if "shopee." in host:
            return f"{base}/search?keyword={q_mais}"
        if "aliexpress." in host:
            return f"{base}/w/wholesale-{slug}.html?SearchText={q_mais}"
        if "americanas." in host or "submarino." in host:
            return f"{base}/busca/{slug}"
        if "magazineluiza." in host or "magalu." in host:
            return f"{base}/busca/{q_pct}/"
        if "mercadolivre." in host:
            return f"https://lista.mercadolivre.com.br/{slug}"
        if "amazon." in host:
            return f"{base}/s?k={q_mais}"
        if "shein." in host:
            return f"{base}/pdsearch/{q_pct}/"
        if "kabum." in host:
            return f"{base}/busca/{slug}"
        if "casasbahia." in host or "pontofrio." in host or "extra.com" in host:
            return f"{base}/{slug}/b"
    except Exception:
        pass
    return None


def dominio_base(url: str) -> str:
    try:
        host = urlparse(url).netloc.lower()
        partes = host.split(".")
        if len(partes) >= 3 and partes[-2] in ("com", "net", "org"):
            return ".".join(partes[-3:])
        return ".".join(partes[-2:]) if len(partes) >= 2 else host
    except Exception:
        return ""


# ----------------------------------------------------------------------------
# MOTOR DE AUTOMAÇÃO (Selenium)
# ----------------------------------------------------------------------------
class Garimpeiro:
    def __init__(self):
        self.driver = None
        self.lock = threading.RLock()
        self.stop_event = threading.Event()
        self.pausa_evento = threading.Event()   # set() = usuário clicou em Continuar
        self.fila_logs: "queue.Queue[str]" = queue.Queue()
        self.url_atual = ""
        self.aberto = False
        self.aguardando = False                 # True enquanto estiver em pausa
        self.motivo_pausa = ""
        self.tempo_pausado = 0.0
        self._brancos = 0

    # ---- log thread-safe (a UI lê esta fila) ----
    def log(self, msg: str):
        self.fila_logs.put(f"[{datetime.now():%H:%M:%S}] {msg}")

    # ---- Chrome normal + conexão ----
    @staticmethod
    def _achar_chrome():
        candidatos = [
            os.environ.get("CHROME_PATH", ""),
            r"C:\Program Files\Google\Chrome\Application\chrome.exe",
            r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
            os.path.expandvars(r"%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"),
        ]
        for c in candidatos:
            if c and os.path.exists(c):
                return c
        return shutil.which("chrome") or shutil.which("google-chrome")

    @staticmethod
    def _porta_aberta() -> bool:
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sk:
                sk.settimeout(1)
                return sk.connect_ex(("127.0.0.1", PORTA_DEBUG)) == 0
        except Exception:
            return False

    def _criar_driver(self):
        """Abre o Google Chrome NORMAL (sem flags de automação) e conecta nele."""
        if not self._porta_aberta():
            exe = self._achar_chrome()
            if not exe:
                raise RuntimeError(
                    "Chrome não encontrado. Defina a variável de ambiente CHROME_PATH com o caminho do chrome.exe."
                )
            PERFIL_CHROME.mkdir(parents=True, exist_ok=True)
            self.log("Abrindo o Google Chrome normal...")
            flags = 0
            if os.name == "nt":
                flags = subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP
            subprocess.Popen(
                [
                    exe,
                    f"--remote-debugging-port={PORTA_DEBUG}",
                    f"--user-data-dir={PERFIL_CHROME}",
                    "--start-maximized",
                    "--no-first-run",
                    "--no-default-browser-check",
                    "--lang=pt-BR",
                    f"--profile-directory={self._nome_perfil()}",
                ],
                creationflags=flags,
            )
            for _ in range(40):
                if self._porta_aberta():
                    break
                time.sleep(0.5)
            else:
                raise RuntimeError("O Chrome não respondeu na porta de conexão.")
        else:
            self.log("Chrome do robô já está aberto: reaproveitando a janela.")

        opts = Options()
        opts.add_experimental_option("debuggerAddress", f"127.0.0.1:{PORTA_DEBUG}")
        try:
            from webdriver_manager.chrome import ChromeDriverManager

            service = Service(ChromeDriverManager().install())
        except Exception as e:
            self.log(f"[AVISO] webdriver-manager falhou ({type(e).__name__}). Usando Selenium Manager.")
            service = Service()

        driver = webdriver.Chrome(service=service, options=opts)
        driver.set_page_load_timeout(60)
        driver.set_script_timeout(30)
        return driver

    @staticmethod
    def _nome_perfil() -> str:
        """Nome da pasta de perfil usada pelo Chrome do robô (Default ou o perfil copiado)."""
        try:
            arq = PERFIL_CHROME / "perfil_clonado.txt"
            if arq.exists():
                nome = arq.read_text(encoding="utf-8").strip()
                if nome:
                    return nome
        except Exception:
            pass
        return "Default"

    def clonar_perfil(self, substituir: bool = False) -> bool:
        """Copia o perfil do SEU Chrome (favoritos, histórico, extensões, configurações)
        para a pasta do robô. O Chrome do dia a dia precisa estar totalmente fechado."""
        with self.lock:
            if self.driver is not None or self._porta_aberta():
                self.log("[ERRO] Feche o navegador do robô antes de copiar (botão 'Fechar navegador').")
                return False
            if not CHROME_ORIGINAL.exists():
                self.log(f"[ERRO] Não encontrei o perfil do seu Chrome em: {CHROME_ORIGINAL}")
                return False

            nome = "Default"
            try:
                with open(CHROME_ORIGINAL / "Local State", "r", encoding="utf-8") as f:
                    nome = json.load(f).get("profile", {}).get("last_used") or "Default"
            except Exception:
                pass
            origem = CHROME_ORIGINAL / nome
            if not origem.exists():
                self.log(f"[ERRO] Pasta do perfil '{nome}' não encontrada em {CHROME_ORIGINAL}.")
                return False

            self.log(f"Copiando o perfil '{nome}' do seu Chrome. FECHE todas as janelas do Chrome do dia a dia. "
                     "Isso pode levar alguns minutos...")
            falhas = []

            def copiar(src, dst):
                try:
                    shutil.copy2(src, dst)
                except Exception:
                    falhas.append(str(src))

            try:
                if PERFIL_CHROME.exists():
                    if not substituir:
                        self.log("[ERRO] O perfil do robô já existe. Confirme a substituição para copiar de novo.")
                        return False
                    shutil.rmtree(PERFIL_CHROME, ignore_errors=True)
                PERFIL_CHROME.mkdir(parents=True, exist_ok=True)
                try:
                    shutil.copytree(
                        origem,
                        PERFIL_CHROME / nome,
                        ignore=shutil.ignore_patterns(*PASTAS_IGNORADAS_CLONE),
                        copy_function=copiar,
                        dirs_exist_ok=True,
                    )
                except shutil.Error:
                    pass  # arquivos travados já foram contados em 'falhas'
                shutil.copy2(CHROME_ORIGINAL / "Local State", PERFIL_CHROME / "Local State")
                (PERFIL_CHROME / "perfil_clonado.txt").write_text(nome, encoding="utf-8")
            except Exception as e:
                self.log(f"[ERRO] Falha ao copiar o perfil: {type(e).__name__}: {str(e)[:200]}")
                return False

            if any("Cookies" in f or "Login Data" in f for f in falhas):
                self.log("[AVISO] Alguns arquivos estavam em uso (Chrome ainda aberto?). Feche o Chrome por completo e copie de novo.")
            self.log(f"Perfil copiado ({len(falhas)} arquivos ignorados por estarem em uso).")
            self.log(">>> Favoritos, histórico e extensões vieram. O LOGIN dos sites provavelmente precisa ser refeito UMA vez "
                     "no Chrome do robô (o Chrome usa outra chave de criptografia nessa pasta). Depois ele fica salvo.")
            return True

    def _viva(self) -> bool:
        """True se a sessão do Chrome ainda responde."""
        if self.driver is None:
            return False
        try:
            _ = self.driver.window_handles
            self.driver.execute_script("return 1;")
            return True
        except NoSuchWindowException:
            # Aba atual fechada pelo usuário: tenta voltar para outra aba
            try:
                handles = self.driver.window_handles
                if handles:
                    self.driver.switch_to.window(handles[-1])
                    return True
            except Exception:
                pass
            return False
        except Exception:
            return False

    def _foco(self):
        """Garante que o driver aponta para uma aba existente (a mais recente)."""
        handles = self.driver.window_handles
        if not handles:
            raise NoSuchWindowException("Nenhuma aba aberta.")
        try:
            atual = self.driver.current_window_handle
        except Exception:
            atual = None
        if atual not in handles:
            self.driver.switch_to.window(handles[-1])

    def _fechar_driver(self):
        drv, self.driver = self.driver, None
        self.aberto = False
        if drv is not None:
            try:
                drv.quit()
            except Exception:
                pass

    def _navegar(self, url: str):
        try:
            self.driver.get(url)
        except TimeoutException:
            self.log("[AVISO] A página demorou para carregar. Interrompendo o carregamento e seguindo.")
            try:
                self.driver.execute_script("window.stop();")
            except Exception:
                pass

    # ---- PASSO A: abrir ----
    def abrir(self, url: str) -> bool:
        url = normalizar_url_digitada(url)
        if not url_parece_valida(url):
            self.log("[ERRO] URL inválida. Exemplo: https://www.site.com.br/categoria")
            return False
        with self.lock:
            for tentativa in (1, 2):
                try:
                    if not self._viva():
                        self.log("Abrindo o Google Chrome (isso pode levar alguns segundos)...")
                        self._fechar_driver()
                        self.driver = self._criar_driver()
                    self.log(f"Acessando: {url}")
                    self._foco()
                    self._navegar(url)
                    self.url_atual = url
                    self.aberto = True
                    self.log("Página carregada.")
                    return True
                except Exception as e:
                    msg = str(e)
                    self.log(f"[ERRO] Tentativa {tentativa}/2 ao abrir: {type(e).__name__}: {msg[:200]}")
                    if "session not created" in msg.lower() or "only supports chrome version" in msg.lower():
                        self.log("[DICA] O ChromeDriver não combina com a versão do seu Chrome. Atualize o Google Chrome.")
                    self._fechar_driver()
                    time.sleep(2)
            self.log(
                "[ERRO] Não foi possível abrir o Chrome. Verifique: (1) se o Chrome está instalado e atualizado; "
                f"(2) se a porta {PORTA_DEBUG} não está em uso por outro programa; (3) sua conexão com a internet."
            )
            return False

    def _recuperar(self) -> bool:
        """Reinicia o Chrome caso tenha caído e volta para a URL atual."""
        self.log("[RECUPERAÇÃO] O Chrome parou de responder. Reiniciando o navegador...")
        try:
            self._fechar_driver()
            self.driver = self._criar_driver()
            self.aberto = True
            if self.url_atual:
                self._navegar(self.url_atual)
            time.sleep(5)
            self.log("[RECUPERAÇÃO] Navegador reiniciado (o login é mantido pelo perfil salvo).")
            return True
        except Exception as e:
            self.log(f"[ERRO] Falha ao recuperar o navegador: {type(e).__name__}: {str(e)[:200]}")
            return False

    # ---- detecção de problemas + pausa para o humano ----
    def _detectar_problema(self):
        """Retorna o motivo (str) se a tela precisa de ajuda humana; senão None.
        Pode levantar exceção se a aba/Chrome travou (tratada por quem chama)."""
        d = self.driver.execute_script(JS_DIAGNOSTICO) or {}
        url = d.get("url", "")
        texto = d.get("texto", "")
        titulo = d.get("titulo", "")

        if url.startswith("chrome-error://") or any(
            f in titulo or f in texto[:1500] for f in FRASES_ERRO_CARREGAMENTO
        ):
            return "Erro de carregamento da página (sem internet, site fora do ar ou aba travada). Recarregue (F5) ou volte para a página."
        if any(p in url for p in ("/verify/captcha", "/verify/traffic", "anti_bot", "/verify/")):
            return ("O site abriu a verificação anti-robô. Clique em 'Tentar novamente' ou resolva o desafio. "
                    "Se disser 'tente em alguns minutos', espere um pouco antes de continuar.")
        if d.get("desafio"):
            return "Captcha / verificação de segurança na tela. Resolva na janela do Chrome."
        for frase in FRASES_BLOQUEIO:
            if frase in titulo or frase in texto:
                return f"Bloqueio detectado ('{frase}'). Resolva na janela do Chrome."
        if any(parte in url for parte in PARTES_URL_LOGIN):
            return "O site pediu login. Faça o login na janela do Chrome e volte para a página dos produtos."
        if d.get("pronto") != "loading" and d.get("tamanho", 0) < 30:
            self._brancos += 1
            if self._brancos >= 3:
                self._brancos = 0
                return "Página em branco ou travada. Recarregue (F5) ou volte para a página dos produtos."
        else:
            self._brancos = 0
        return None

    def _pausar(self, motivo: str) -> str:
        """Pausa a automação e ESPERA o usuário. Retorna 'continuar' ou 'parar'."""
        self.motivo_pausa = motivo
        self.pausa_evento.clear()
        self.aguardando = True
        self.log(f"⏸ PAUSA: {motivo}")
        self.log(">>> Resolva na janela do Chrome e clique em 'Continuar'. Para encerrar guardando o que já foi coletado, clique em 'Parar e salvar'.")
        try:
            self.driver.execute_script("window.focus();")
        except Exception:
            pass
        inicio = time.time()
        ultimo_lembrete = inicio
        while not self.pausa_evento.wait(1.0):
            if time.time() - ultimo_lembrete >= 60:
                ultimo_lembrete = time.time()
                self.log("⏸ Ainda aguardando você... (Continuar / Parar e salvar)")
        self.tempo_pausado += time.time() - inicio
        self.aguardando = False
        self.motivo_pausa = ""
        if self.stop_event.is_set():
            return "parar"
        self.log("▶ Continuando a automação...")
        return "continuar"

    # ---- PASSO B: varredura ----
    def _rolar(self, sem_novos: int):
        self.driver.execute_script(JS_ROLAR, random.uniform(0.35, 0.8))
        # "Balançada" para disparar carregamento lazy quando travar no fim
        if sem_novos and sem_novos % 3 == 0:
            time.sleep(0.6)
            self.driver.execute_script("window.scrollBy(0, -450);")
            time.sleep(0.6)
        # Ritmo humano: pausas variadas e, de vez em quando, uma pausa maior
        espera = random.uniform(1.3, 2.8) + (1.0 if sem_novos > 2 else 0.0)
        if random.random() < 0.12:
            espera += random.uniform(3.0, 6.0)
        time.sleep(espera)

    def _avancar_pagina(self) -> bool:
        """Clica em 'próxima página' / 'ver mais' se existir."""
        try:
            return bool(self.driver.execute_script(JS_PROXIMA_PAGINA))
        except Exception:
            return False

    def extrair(self, alvo: int, apenas_produtos: bool = True, categorias=None) -> dict:
        """Sem categorias: varre a página aberta.
        Com categorias [(nome, termo)]: busca cada uma no site aberto e extrai 'alvo' links POR categoria."""
        with self.lock:
            if not self._viva():
                raise RuntimeError("O navegador não está aberto. Clique em 'Abrir site' primeiro.")
            self.stop_event.clear()

            if not categorias:
                return self._salvar(self._varrer(alvo, apenas_produtos, pausar_no_fim=True))

            total_novos = total_coletados = 0
            tudo_ok = True
            arquivo = ""
            for i, (nome, termo) in enumerate(categorias, 1):
                if self.stop_event.is_set():
                    break
                self.log(f"=== Categoria {i}/{len(categorias)}: {nome} ===")
                try:
                    self._foco()
                    url_busca = montar_url_busca(self.driver.current_url, termo)
                    if url_busca:
                        self.log(f"Buscando '{termo}': {url_busca}")
                        self._navegar(url_busca)
                        time.sleep(random.uniform(3.5, 6.0))
                    elif self._pausar(
                        f"Não sei buscar categorias neste site. Na janela do Chrome, navegue até a categoria "
                        f"'{nome}' e clique em 'Continuar' (ou 'Parar e salvar')."
                    ) == "parar":
                        break
                    lista = self._varrer(alvo, apenas_produtos, pausar_no_fim=False)
                except Exception as e:
                    self.log(f"[ERRO] Categoria '{nome}': {type(e).__name__}: {str(e)[:150]}")
                    if not self._viva():
                        self.log("[ERRO] O Chrome não responde mais. Encerrando as categorias.")
                        break
                    continue
                res = self._salvar(lista, categoria=nome)
                tudo_ok = tudo_ok and res.get("ok", False)
                total_novos += res.get("novos", 0)
                total_coletados += res.get("coletados", 0)
                arquivo = res.get("arquivo") or arquivo
                if i < len(categorias) and not self.stop_event.is_set():
                    time.sleep(random.uniform(4.0, 8.0))

            self.log(f"Categorias concluídas: {total_coletados} links coletados, {total_novos} novos salvos.")
            return {
                "ok": tudo_ok,
                "coletados": total_coletados,
                "novos": total_novos,
                "arquivo": arquivo or str(ARQUIVO_SAIDA),
            }

    def garimpar_sites(self, sites, alvo: int, apenas_produtos: bool = True, categorias=None) -> dict:
        """Para cada site salvo: abre, (pausa se houver login/captcha) e extrai. Tudo em sequência."""
        self.stop_event.clear()
        total_novos = total_coletados = 0
        sites_ok = 0
        tudo_ok = True
        arquivo = ""
        for i, (nome, url) in enumerate(sites, 1):
            if self.stop_event.is_set():
                break
            self.log(f"##### Site {i}/{len(sites)}: {nome} #####")
            if not self.abrir(url):
                self.log(f"[ERRO] Não consegui abrir '{nome}'. Passando para o próximo.")
                tudo_ok = False
                continue
            time.sleep(random.uniform(3.0, 5.0))
            try:
                res = self.extrair(alvo, apenas_produtos, categorias)
            except Exception as e:
                self.log(f"[ERRO] Falha em '{nome}': {type(e).__name__}: {str(e)[:150]}")
                tudo_ok = False
                continue
            tudo_ok = tudo_ok and res.get("ok", False)
            total_novos += res.get("novos", 0)
            total_coletados += res.get("coletados", 0)
            arquivo = res.get("arquivo") or arquivo
            sites_ok += 1
            if i < len(sites) and not self.stop_event.is_set():
                time.sleep(random.uniform(8.0, 15.0))
        self.log(
            f"##### Fim: {sites_ok}/{len(sites)} sites processados, "
            f"{total_coletados} links coletados, {total_novos} novos salvos. #####"
        )
        return {
            "ok": tudo_ok,
            "sites": sites_ok,
            "coletados": total_coletados,
            "novos": total_novos,
            "arquivo": arquivo or str(ARQUIVO_SAIDA),
        }

    def _varrer(self, alvo: int, apenas_produtos: bool, pausar_no_fim: bool) -> list:
        """Rola a página atual coletando links. Retorna a lista (sem salvar)."""
        with self.lock:
            self.tempo_pausado = 0.0
            self._brancos = 0
            coletados: dict = {}  # dict preserva a ordem de coleta
            inicio = time.time()
            sem_novos = erros_seguidos = recuperacoes = ciclo = tolerancia = 0
            self.log(f"Iniciando varredura. Meta: {alvo} links.")

            while len(coletados) < alvo:
                if self.stop_event.is_set():
                    self.log("Varredura interrompida pelo usuário.")
                    break
                if time.time() - inicio - self.tempo_pausado > TEMPO_MAX_EXTRACAO:
                    self.log("[AVISO] Tempo máximo de varredura atingido (o tempo em pausa não conta).")
                    break
                ciclo += 1
                try:
                    self._foco()

                    # 1) Há algum problema na tela que exige o humano?
                    if tolerancia > 0:
                        tolerancia -= 1
                    else:
                        problema = self._detectar_problema()
                        if problema:
                            if self._pausar(problema) == "parar":
                                break
                            sem_novos = 0
                            tolerancia = 2
                            continue

                    # 2) Coleta os links visíveis agora
                    url_pagina = self.driver.current_url
                    base = dominio_base(url_pagina)
                    antes = len(coletados)
                    for bruto in self.driver.execute_script(JS_COLETAR_LINKS) or []:
                        limpo = limpar_link(bruto)
                        if not limpo or limpo in coletados:
                            continue
                        if apenas_produtos and not parece_produto(limpo, base):
                            continue
                        coletados[limpo] = True
                        if len(coletados) >= alvo:
                            break
                    novos = len(coletados) - antes
                    erros_seguidos = 0

                    if len(coletados) >= alvo:
                        break
                    sem_novos = 0 if novos > 0 else sem_novos + 1

                    # 3) Sem links novos: pode ser fim da página, pop-up, bloqueio...
                    if sem_novos >= LIMITE_CICLOS_SEM_NOVOS:
                        if self._avancar_pagina():
                            self.log("Avancei para a próxima página / ver mais.")
                            sem_novos = 0
                            tolerancia = 1
                            time.sleep(random.uniform(3.0, 5.0))
                            continue
                        if not pausar_no_fim:
                            self.log(f"Fim dos resultados desta categoria ({len(coletados)} links).")
                            break
                        decisao = self._pausar(
                            f"Não aparecem links novos ({len(coletados)}/{alvo}). Pode ser o fim da página, "
                            "um pop-up/bloqueio ou o botão 'ver mais'. Resolva na janela e clique em "
                            "'Continuar', ou clique em 'Parar e salvar'."
                        )
                        if decisao == "parar":
                            break
                        sem_novos = 0
                        tolerancia = 2
                        continue

                    # 4) Rola a página
                    self._rolar(sem_novos)
                    if ciclo % 4 == 0:
                        self.log(f"Progresso: {len(coletados)}/{alvo} links coletados...")

                except Exception as e:
                    erros_seguidos += 1
                    self.log(f"[AVISO] Erro na varredura ({erros_seguidos}): {type(e).__name__}: {str(e)[:150]}")
                    if not self._viva():
                        if recuperacoes >= MAX_RECUPERACOES:
                            self.log("[ERRO] O Chrome caiu várias vezes. Encerrando e salvando o que foi coletado.")
                            break
                        recuperacoes += 1
                        if not self._recuperar():
                            break
                        if self._pausar(
                            "O Chrome foi reiniciado. Se o site pedir login/captcha, resolva agora, "
                            "volte para a página dos produtos e clique em 'Continuar'."
                        ) == "parar":
                            break
                        sem_novos = erros_seguidos = 0
                        tolerancia = 2
                        continue
                    if erros_seguidos >= 5:
                        if self._pausar(
                            "Muitos erros seguidos na página. Recarregue (F5) ou volte para a página dos "
                            "produtos e clique em 'Continuar'."
                        ) == "parar":
                            break
                        erros_seguidos = 0
                        tolerancia = 2
                        continue
                    time.sleep(2)

            lista = list(coletados)[:alvo]
            self.log(f"Varredura concluída: {len(lista)} links únicos coletados.")
            return lista

    # ---- PASSO C: salvar ----
    def _salvar(self, links: list, categoria: str = "") -> dict:
        unicos = set()
        ordenados = []
        for l in links:
            if l and l not in unicos:
                unicos.add(l)
                ordenados.append(l)

        for destino in (ARQUIVO_SAIDA, ARQUIVO_RESERVA):
            try:
                existentes = set()
                if destino.exists():
                    with open(destino, "r", encoding="utf-8", errors="ignore") as f:
                        existentes = {linha.strip() for linha in f if linha.strip()}
                novos = [l for l in ordenados if l not in existentes]
                if novos:
                    with open(destino, "a", encoding="utf-8") as f:
                        f.write("\n".join(novos) + "\n")
                if novos and categoria:
                    self._salvar_csv(destino.parent / ARQUIVO_CSV_NOME, categoria, novos)
                ja_existiam = len(ordenados) - len(novos)
                aviso = "" if destino == ARQUIVO_SAIDA else " (pasta principal sem permissão: usei o arquivo reserva)"
                self.log(
                    f"Salvo em '{destino.name}': {len(novos)} novos "
                    f"({ja_existiam} já existiam no arquivo){aviso}. Caminho: {destino}"
                )
                return {"ok": True, "coletados": len(ordenados), "novos": len(novos), "arquivo": str(destino)}
            except Exception as e:
                self.log(f"[ERRO] Falha ao salvar em {destino}: {type(e).__name__}: {e}")

        self.log("[ERRO] Não consegui salvar em arquivo. Copie os links abaixo antes de fechar:")
        for l in ordenados:
            self.log(l)
        return {"ok": False, "coletados": len(ordenados), "novos": 0, "arquivo": ""}

    def _salvar_csv(self, caminho: Path, categoria: str, links: list):
        """Guarda também categoria;site;link (abre direto no Excel)."""
        try:
            novo = not caminho.exists()
            with open(caminho, "a", encoding="utf-8-sig", newline="") as f:
                if novo:
                    f.write("categoria;site;link\n")
                for l in links:
                    f.write(f"{categoria};{urlparse(l).netloc};{l}\n")
        except Exception as e:
            self.log(f"[AVISO] Não consegui gravar o CSV por categoria: {e}")

    # ---- encerrar ----
    def fechar(self):
        self.stop_event.set()
        self.pausa_evento.set()   # libera qualquer pausa em andamento
        with self.lock:
            self._fechar_driver()
        self.log("Navegador fechado.")


# Integração opcional com a Uti Like: usa a mesma sessão local do Chrome.
# Não armazena o token em disco. Os campos comerciais NÃO são presumidos.
def capturar_detalhes_visiveis(driver):
    js = r"""
    const metas = [...document.querySelectorAll('meta[property],meta[name]')];
    const meta = k => (metas.find(x => (x.getAttribute('property')||x.getAttribute('name')||'').toLowerCase()===k)?.content||'');
    const imagens = [...new Set([meta('og:image'),...Array.from(document.images).map(i=>i.currentSrc||i.src)])]
      .filter(u=>{try {const x=new URL(u);return x.protocol==='https:' && /(?:alicdn|aliexpress|ae-pic)/i.test(x.hostname) && !/logo|avatar|icon|flag/i.test(x.pathname)}catch{return false}}).slice(0,12);
    return {url:location.href,nome:(document.querySelector('h1')?.innerText||meta('og:title')||document.title||'').trim(),descricao:meta('og:description')||'',imagens};
    """
    return driver.execute_script(js)


def enviar_para_neon(base,chave,endpoint,payload):
    from urllib.request import Request, urlopen
    from urllib.error import HTTPError
    base=base.strip().rstrip('/')
    if not base.startswith('https://') or not chave.strip():
        raise ValueError('Informe a URL HTTPS do Render e a chave de integração.')
    req=Request(base+endpoint,data=json.dumps(payload).encode('utf-8'),headers={'Content-Type':'application/json','X-Garimpagem-Key':chave.strip()},method='POST')
    try:
        with urlopen(req,timeout=45) as resp:
            return json.loads(resp.read().decode('utf-8'))
    except HTTPError as e:
        raise RuntimeError('API retornou HTTP '+str(e.code)+': '+e.read(300).decode('utf-8','replace'))

bot = Garimpeiro()
app.on_shutdown(bot.fechar)

# ----------------------------------------------------------------------------
# INTERFACE (NiceGUI)
# ----------------------------------------------------------------------------
estado_ui = {"texto_log": "", "avisou": False, "fase": "abrir", "destaque": None}
checks_categorias = {}

ui.page_title("Garimpagem - Loja Tech")
ui.add_css(
    """
    @keyframes piscar {
      0%, 100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(255, 193, 7, 0.95); }
      50% { transform: scale(1.08); box-shadow: 0 0 18px 8px rgba(255, 193, 7, 0.95); }
    }
    .piscar { animation: piscar 0.9s infinite; outline: 3px solid #ffc107; }
    """
)

with ui.column().classes("w-full max-w-4xl mx-auto p-4 gap-4"):
    ui.label("⛏️ Garimpagem de Links - Loja Tech").classes("text-2xl font-bold")

    banner = ui.label("").classes(
        "w-full p-3 rounded bg-orange-200 text-orange-900 font-bold text-base"
    )
    banner.set_visibility(False)

    with ui.card().classes("w-full"):
        ui.label("Sites salvos (arquivo config_garimpagem.txt)").classes("text-lg font-semibold")
        with ui.row().classes("w-full items-center gap-2"):
            select_sites = ui.select(options=[], label="Escolha um site salvo").classes("w-72").props("outlined")
            btn_recarregar = ui.button("Recarregar arquivo", icon="refresh").props("outline")
            btn_editar = ui.button("Editar sites", icon="edit").props("outline")
        btn_todos = ui.button("Garimpar TODOS os sites salvos", icon="play_circle", color="green")
        label_sites = ui.label("").classes("text-sm text-gray-600")

    with ui.card().classes("w-full"):
        url_input = ui.input(
            label="URL do site (Shopee, AliExpress, Shein, Magalu...)",
            placeholder="https://...",
        ).classes("w-full").props("clearable outlined")

        with ui.row().classes("w-full items-center gap-4"):
            qtd_input = ui.number(
                label="Quantidade de links (por categoria)", value=50, min=1, max=10000, step=10, precision=0
            ).props("outlined").classes("w-72")
            chk_produtos = ui.checkbox("Somente links de produto", value=True)

        with ui.row().classes("gap-2"):
            btn_abrir = ui.button("1) Abrir site", icon="open_in_browser")
            btn_extrair = ui.button("2) Iniciar extração", icon="download", color="green")
            btn_continuar = ui.button("▶ Continuar (já resolvi)", color="primary")
            btn_parar = ui.button("Parar e salvar", icon="stop", color="orange")
            btn_fechar = ui.button("Fechar navegador", icon="close", color="red").props("outline")
            btn_clonar = ui.button("Copiar meu Chrome", icon="content_copy").props("outline")
        btn_extrair.disable()
        btn_continuar.disable()
        btn_parar.disable()

    with ui.card().classes("w-full"):
        ui.label("Categorias (opcional)").classes("text-lg font-semibold")
        ui.label(
            "Marque as categorias que o robô deve buscar no site aberto. A quantidade acima vale POR categoria. "
            "Sem marcar nada, ele varre a página que estiver aberta."
        ).classes("text-sm text-gray-600")
        with ui.row().classes("gap-2"):
            ui.button("Marcar todas", on_click=lambda: [c.set_value(True) for c in checks_categorias.values()]).props("flat dense")
            ui.button("Limpar", on_click=lambda: [c.set_value(False) for c in checks_categorias.values()]).props("flat dense")
        with ui.row().classes("w-full gap-x-6"):
            for _nome, _termo in CATEGORIAS:
                checks_categorias[_nome] = ui.checkbox(_nome)
        outras_input = ui.input(
            label="Outras categorias (separe por vírgula)",
            placeholder="ex: lanterna tática, tapete de yoga",
        ).classes("w-full").props("outlined clearable")

    with ui.card().classes("w-full"):
        ui.label("Integração Uti Like / Neon (opcional)").classes("text-lg font-semibold")
        ui.label("O navegador é aberto NESTE computador. As URLs e imagens são enviadas ao Render e salvas no Neon. Nenhum preço, estoque ou frete será inventado.")
        render_url = ui.input("URL pública do Render",value="https://utilike.onrender.com").classes("w-full")
        chave_integracao = ui.input("Chave exclusiva da Garimpagem (não será salva)",password=True,password_toggle_button=True).classes("w-full")
        with ui.row():
            btn_enviar_links = ui.button("Enviar URLs do TXT ao Neon",color="green")
            btn_capturar = ui.button("Capturar imagens da página aberta e enviar para revisão",color="primary")
        ui.label("Para capturar imagens, abra a página de UM produto no Chrome do robô. A captura usa apenas imagens disponíveis na página e requer conferência.").classes("text-sm text-gray-600")

    ui.label("Console").classes("text-lg font-semibold")
    log_area = ui.textarea().props("readonly outlined").classes("w-full").style(
        "font-family: Consolas, monospace; font-size: 13px;"
    )
    log_area.props('rows=16 input-style="height: 320px;"')

# Diálogo do Passo D
with ui.dialog() as dialogo, ui.card():
    ui.label("✅ Links salvos com sucesso!").classes("text-lg font-bold")
    ui.label("Deseja capturar links de outro site?")
    with ui.row().classes("justify-end w-full"):
        btn_nao = ui.button("Não, terminei", color="grey").props("flat")
        btn_sim = ui.button("Sim, outro site", color="green")

with ui.dialog() as dialogo_clone, ui.card():
    ui.label("Copiar o perfil do seu Chrome").classes("text-lg font-bold")
    ui.label("Feche TODAS as janelas do seu Chrome antes. Se o robô já tem um perfil salvo, ele será SUBSTITUÍDO (você terá que logar de novo nos sites).")
    with ui.row().classes("justify-end w-full"):
        btn_clone_nao = ui.button("Cancelar", color="grey").props("flat")
        btn_clone_sim = ui.button("Copiar agora", color="green")

JS_BIP = (
    "try{const c=new (window.AudioContext||window.webkitAudioContext)();"
    "const o=c.createOscillator();o.frequency.value=880;o.connect(c.destination);"
    "o.start();setTimeout(()=>{o.stop();c.close();},400);}catch(e){}"
)


def destacar_botoes():
    """Faz piscar o botão do próximo passo: Abrir -> Extrair -> (pausa: Continuar) -> Abrir..."""
    alvo = "continuar" if bot.aguardando else estado_ui["fase"]
    if alvo == estado_ui["destaque"]:
        return
    estado_ui["destaque"] = alvo
    for nome, btn in (("abrir", btn_abrir), ("extrair", btn_extrair), ("continuar", btn_continuar)):
        if nome == alvo:
            btn.classes(add="piscar")
        else:
            btn.classes(remove="piscar")


def atualizar_painel():
    """Roda a cada 0.5s: sincroniza pausa/botões e despeja os logs no console."""
    aguardando = bot.aguardando
    btn_continuar.set_enabled(aguardando)
    banner.set_visibility(aguardando)
    if aguardando:
        banner.text = f"⏸ AUTOMAÇÃO EM PAUSA - precisa de você: {bot.motivo_pausa}"
        if not estado_ui["avisou"]:
            estado_ui["avisou"] = True
            ui.notify("Automação em pausa: precisa da sua ação no navegador.", type="warning", timeout=8000)
            ui.run_javascript(JS_BIP)
    else:
        estado_ui["avisou"] = False
    destacar_botoes()

    linhas = []
    while True:
        try:
            linhas.append(bot.fila_logs.get_nowait())
        except queue.Empty:
            break
    if not linhas:
        return
    todas = (estado_ui["texto_log"] + "\n".join(linhas) + "\n").splitlines()
    todas = todas[-MAX_LINHAS_LOG:]
    estado_ui["texto_log"] = "\n".join(todas) + "\n"
    log_area.value = estado_ui["texto_log"]
    ui.run_javascript(
        f'const t = document.querySelector("#c{log_area.id} textarea"); if (t) t.scrollTop = t.scrollHeight;'
    )


ui.timer(0.5, atualizar_painel)


def definir_ocupado(ocupado: bool, extraindo: bool = False):
    btn_abrir.set_enabled(not ocupado)
    btn_clonar.set_enabled(not ocupado)
    btn_todos.set_enabled(not ocupado)
    btn_recarregar.set_enabled(not ocupado)
    btn_extrair.set_enabled((not ocupado) and bot.aberto)
    btn_parar.set_enabled(extraindo)
    if ocupado:
        estado_ui["fase"] = None
    elif estado_ui["fase"] is None or not bot.aberto:
        estado_ui["fase"] = "extrair" if bot.aberto else "abrir"


async def clicar_abrir():
    url = normalizar_url_digitada(url_input.value or "")
    if not url:
        ui.notify("Digite ou cole a URL do site.", type="warning")
        return
    if not url_parece_valida(url):
        ui.notify("URL inválida. Exemplo: https://www.site.com.br", type="warning")
        return
    definir_ocupado(True)
    try:
        ok = await run.io_bound(bot.abrir, url)
        if ok:
            bot.log(">>> Faça o login ou resolva qualquer captcha/bloqueio na tela do navegador, e depois clique no botão de continuar/extrair.")
            bot.log(">>> O botão 2 (Iniciar extração) está piscando: clique nele quando terminar o login.")
        else:
            ui.notify("Não foi possível abrir o site. Veja o console.", type="negative")
    except Exception as e:
        bot.log(f"[ERRO] {type(e).__name__}: {str(e)[:200]}")
    finally:
        definir_ocupado(False)


def coletar_categorias():
    sel = [(n, t) for n, t in CATEGORIAS if checks_categorias[n].value]
    for item in (outras_input.value or "").split(","):
        item = item.strip()
        if item:
            sel.append((item, item))
    return sel


async def clicar_extrair():
    try:
        alvo = int(qtd_input.value or 0)
    except (TypeError, ValueError):
        alvo = 0
    if alvo < 1:
        ui.notify("Informe uma quantidade válida (mínimo 1).", type="warning")
        return
    definir_ocupado(True, extraindo=True)
    try:
        categorias = coletar_categorias()
        res = await run.io_bound(bot.extrair, alvo, bool(chk_produtos.value), categorias)
        if res.get("ok") and res.get("coletados", 0) > 0:
            ui.notify(f"{res['novos']} links novos salvos em {Path(res['arquivo']).name}", type="positive")
            dialogo.open()
            estado_ui["fase"] = "abrir"   # próximo passo: outro site (botão 1 pisca)
        elif res.get("ok"):
            ui.notify(
                "Nenhum link coletado. Desmarque 'Somente links de produto' ou confira se a página carregou.",
                type="warning",
            )
        else:
            ui.notify("Falha ao salvar o arquivo. Veja o console.", type="negative")
    except Exception as e:
        bot.log(f"[ERRO] {type(e).__name__}: {str(e)[:200]}")
        ui.notify("Erro na extração. Veja o console.", type="negative")
    finally:
        definir_ocupado(False)


def chave_categoria(texto: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", sem_acentos(texto.lower())).strip()


def aplicar_config(aplicar_padroes: bool = True):
    """Lê o arquivo, preenche a lista de sites e (na abertura) os padrões: quantidade, filtro e categorias."""
    criar_config_exemplo()
    cfg = carregar_config()
    estado_ui["sites"] = dict(cfg["sites"])
    nomes = list(estado_ui["sites"])
    select_sites.options = nomes
    select_sites.update()
    if nomes and select_sites.value not in nomes:
        select_sites.value = nomes[0]   # já preenche a URL do primeiro site
    elif nomes:
        url_input.value = estado_ui["sites"][select_sites.value]
    resumo = f"{len(nomes)} site(s) no arquivo: {', '.join(nomes) if nomes else 'nenhum'}"
    if cfg["erros"]:
        resumo += "  |  Atenção: " + " ".join(cfg["erros"])
    label_sites.text = resumo
    bot.log(f"Configuração lida: {resumo}")

    if not aplicar_padroes:
        return
    if cfg["quantidade"]:
        qtd_input.value = cfg["quantidade"]
    if cfg["somente_produtos"] is not None:
        chk_produtos.value = cfg["somente_produtos"]
    cats = cfg["categorias"]
    if cats is None:
        return
    outras = []
    if cats == "todas":
        for c in checks_categorias.values():
            c.value = True
    else:
        for c in checks_categorias.values():
            c.value = False
        mapa = {chave_categoria(n): n for n in checks_categorias}
        for pedido in cats:
            k = chave_categoria(pedido)
            nome = mapa.get(k) or next((n for kk, n in mapa.items() if k and k in kk), None)
            if nome:
                checks_categorias[nome].value = True
            else:
                outras.append(pedido)
    outras_input.value = ", ".join(outras)


def escolher_site(e):
    url = estado_ui.get("sites", {}).get(e.value)
    if url:
        url_input.value = url


def clicar_recarregar():
    aplicar_config(aplicar_padroes=False)
    ui.notify("Arquivo de sites recarregado.", type="positive")


def clicar_editar():
    criar_config_exemplo()
    try:
        if os.name == "nt":
            os.startfile(str(ARQUIVO_CONFIG))  # abre no Bloco de Notas
            bot.log("Arquivo aberto no Bloco de Notas. Salve, e clique em 'Recarregar arquivo'.")
        else:
            ui.notify(f"Edite o arquivo: {ARQUIVO_CONFIG}", type="info")
    except Exception as e:
        ui.notify(f"Abra manualmente: {ARQUIVO_CONFIG} ({e})", type="warning")


async def clicar_todos():
    cfg = carregar_config()
    sites = cfg["sites"]
    if not sites:
        ui.notify("Nenhum site no arquivo config_garimpagem.txt. Clique em 'Editar sites'.", type="warning")
        return
    try:
        alvo = int(qtd_input.value or 0)
    except (TypeError, ValueError):
        alvo = 0
    if alvo < 1:
        ui.notify("Informe uma quantidade válida (mínimo 1).", type="warning")
        return
    definir_ocupado(True, extraindo=True)
    try:
        res = await run.io_bound(bot.garimpar_sites, sites, alvo, bool(chk_produtos.value), coletar_categorias())
        ui.notify(
            f"{res.get('sites', 0)} site(s) processados, {res.get('novos', 0)} links novos salvos.",
            type="positive" if res.get("ok") else "warning",
        )
        estado_ui["fase"] = "abrir"
    except Exception as e:
        bot.log(f"[ERRO] {type(e).__name__}: {str(e)[:200]}")
        ui.notify("Erro ao garimpar todos os sites. Veja o console.", type="negative")
    finally:
        definir_ocupado(False)


def clicar_continuar():
    bot.pausa_evento.set()


def clicar_parar():
    bot.stop_event.set()
    bot.pausa_evento.set()   # se estiver em pausa, libera para salvar
    bot.log("Parando e salvando o que já foi coletado...")


async def clicar_fechar():
    await run.io_bound(bot.fechar)
    estado_ui["fase"] = "abrir"
    definir_ocupado(False)


def novo_site():
    dialogo.close()
    url_input.value = ""
    url_input.run_method("focus")
    bot.log(">>> Pronto para o próximo site: cole a nova URL, defina a quantidade e clique em 'Abrir site'.")


def encerrar_loop():
    dialogo.close()
    bot.log("Sessão de garimpagem finalizada. Você pode fechar o navegador quando quiser.")


async def executar_clone():
    dialogo_clone.close()
    definir_ocupado(True)
    try:
        ok = await run.io_bound(bot.clonar_perfil, True)
        ui.notify(
            "Perfil copiado. Agora clique em Abrir site e faça o login uma vez." if ok else "Não foi possível copiar. Veja o console.",
            type="positive" if ok else "negative",
        )
    except Exception as e:
        bot.log(f"[ERRO] {type(e).__name__}: {str(e)[:200]}")
    finally:
        definir_ocupado(False)


def clicar_clonar():
    dialogo_clone.open()


async def clicar_enviar_links():
    def tarefa():
        if not ARQUIVO_SAIDA.exists(): raise RuntimeError('Ainda não existe links_garimpados.txt. Faça a garimpagem primeiro.')
        links=list(dict.fromkeys(limpar_link(x) for x in ARQUIVO_SAIDA.read_text(encoding='utf-8-sig').splitlines()))
        links=[x for x in links if x and 'aliexpress.' in urlparse(x).netloc and re.search(r'/item/\d+\.html',urlparse(x).path)]
        if not links: raise RuntimeError('Nenhuma URL de produto AliExpress encontrada no TXT.')
        resultados=[]
        for i in range(0,len(links),1000):
            resultados.append(enviar_para_neon(render_url.value,chave_integracao.value,'/api/garimpagem/lotes',{'urls':links[i:i+1000],'fornecedor':'auto'}))
        return len(links),resultados
    try:
        n,results=await run.io_bound(tarefa)
        bot.log(f'Neon: {n} URLs enviadas em {len(results)} lote(s). Resposta: {results}')
        ui.notify(f'{n} URLs transmitidas ao Neon. Confira duplicatas na fila.',type='positive')
    except Exception as e:
        bot.log(f'[ERRO INTEGRAÇÃO] {e}')
        ui.notify(str(e)[:180],type='negative')


async def clicar_capturar_imagens():
    def tarefa():
        with bot.lock:
            if not bot._viva(): raise RuntimeError('Abra o navegador do robô primeiro.')
            dados=capturar_detalhes_visiveis(bot.driver)
        if not re.search(r'/item/\d+\.html',urlparse(dados.get('url','')).path):
            raise RuntimeError('Abra a página individual de um produto AliExpress antes de capturar.')
        return enviar_para_neon(render_url.value,chave_integracao.value,'/api/garimpagem/captura-local',dados)
    try:
        resposta=await run.io_bound(tarefa)
        bot.log(f'Captura salva no Neon para REVISÃO: {resposta}')
        ui.notify('Título e imagens enviados ao Neon para revisão.',type='positive')
    except Exception as e:
        bot.log(f'[ERRO CAPTURA] {e}')
        ui.notify(str(e)[:180],type='negative')

btn_enviar_links.on_click(clicar_enviar_links)
btn_capturar.on_click(clicar_capturar_imagens)

btn_abrir.on_click(clicar_abrir)
btn_extrair.on_click(clicar_extrair)
btn_continuar.on_click(clicar_continuar)
btn_parar.on_click(clicar_parar)
btn_fechar.on_click(clicar_fechar)
btn_sim.on_click(novo_site)
btn_clonar.on_click(clicar_clonar)
btn_clone_nao.on_click(dialogo_clone.close)
btn_clone_sim.on_click(executar_clone)
btn_nao.on_click(encerrar_loop)
select_sites.on_value_change(escolher_site)
btn_recarregar.on_click(clicar_recarregar)
btn_editar.on_click(clicar_editar)
btn_todos.on_click(clicar_todos)

estado_ui["sites"] = {}
aplicar_config()
bot.log("Sistema pronto. Escolha um site salvo (ou cole uma URL) e clique em 'Abrir site', ou use 'Garimpar TODOS os sites salvos'.")

if __name__ in {"__main__", "__mp_main__"}:
    ui.run(title="Garimpagem - Loja Tech", port=8080, reload=False, show=True)
