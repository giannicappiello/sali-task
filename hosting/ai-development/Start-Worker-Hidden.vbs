Option Explicit
Dim shell, command, exitCode, root
Set shell = CreateObject("WScript.Shell")
root = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = root
command = """" & shell.ExpandEnvironmentStrings("%SystemRoot%") & "\System32\WindowsPowerShell\v1.0\powershell.exe"" -NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -File """ & root & "\Start-Worker.ps1"""
exitCode = shell.Run(command, 0, True)
WScript.Quit exitCode
