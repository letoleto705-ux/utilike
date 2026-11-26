Option Explicit
Dim fso, wsh, base, pythonw, iniciador
Set fso = CreateObject("Scripting.FileSystemObject")
Set wsh = CreateObject("WScript.Shell")
base = fso.GetParentFolderName(WScript.ScriptFullName)
pythonw = fso.BuildPath(base, "robo-copy\.venv\Scripts\pythonw.exe")
iniciador = fso.BuildPath(base, "robo-copy\start_gui.py")
If Not fso.FileExists(pythonw) Then
  MsgBox "Python virtual não encontrado em robo-copy\.venv." & vbCrLf & "Instale as bibliotecas seguindo LEIA_PRIMEIRO_GUI.md.", vbExclamation, "Uti Like • Robô Copy"
ElseIf Not fso.FileExists(iniciador) Then
  MsgBox "Arquivo robo-copy\start_gui.py não encontrado.", vbExclamation, "Uti Like • Robô Copy"
Else
  wsh.Run Chr(34) & pythonw & Chr(34) & " " & Chr(34) & iniciador & Chr(34), 0, False
End If
