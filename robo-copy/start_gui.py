"""Inicializador para pythonw.exe: mostra erros em janela, nunca em console."""
from __future__ import annotations
import sys
import traceback
from tkinter import Tk, messagebox

def erro(titulo, mensagem):
    root = Tk()
    root.withdraw()
    try:
        messagebox.showerror(titulo, mensagem, parent=root)
    finally:
        root.destroy()


if __name__ == '__main__':
    try:
        import customtkinter  # noqa F401
    except ImportError:
        erro('Uti Like • Instalação pendente',
             'Falta instalar CustomTkinter na pasta robo-copy.\n\n'
             'Abra o terminal do VS Code e execute:\n'
             '.\\.venv\\Scripts\\python.exe -m pip install -r requirements.txt')
        sys.exit(1)
    try:
        from gui_robo_copy import App
        App().mainloop()
    except Exception as exc:
        # Não exibir traceback nem credenciais; apenas a classe de erro.
        erro('Uti Like • Não foi possível iniciar',
             f'A interface encontrou um erro ({type(exc).__name__}).\n'
             'Confira a instalação e o arquivo LEIA_PRIMEIRO_GUI.md.')
        sys.exit(1)
