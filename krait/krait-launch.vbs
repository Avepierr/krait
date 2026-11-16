' krait launcher ??? runs the app with no console window
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = "C:\Users\karre\OneDrive\Desktop\REA-OpenCode\krait"
sh.Run "cmd /c npx electron .", 0, False



