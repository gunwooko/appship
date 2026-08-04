# README demo recording script (charmbracelet/vhs).
# Regenerate with:
#   cp -R fixtures/rn-voice-app /tmp/appship-demo-app
#   npm run build && npm link      # makes the `appship` command available
#   cd docs && vhs demo.tape
Output demo.gif

Set FontSize 15
Set Width 960
Set Height 720
Set Padding 16
Set Theme "Catppuccin Mocha"
Set TypingSpeed 35ms

Hide
Type "cd /tmp/appship-demo-app && clear"
Enter
Show

Type "appship init"
Sleep 500ms
Enter
# scanner runs, detection summary + first question appear
Sleep 3.5s

# What does your app do?
Type "Record voice memos with one tap, get automatic transcripts, and find them later with location search."
Sleep 600ms
Enter
Sleep 1s

# Target audience
Type "students, journalists"
Sleep 500ms
Enter
Sleep 1s

# Does the app require login? (No)
Sleep 800ms
Enter
Sleep 800ms

# Does the app collect personal data? (detected — accept default)
Sleep 1.2s
Enter
Sleep 800ms

# Countries (worldwide)
Sleep 600ms
Enter
Sleep 800ms

# Locales — append ko-KR
Type ", ko-KR"
Sleep 500ms
Enter
Sleep 3s

Type "appship doctor"
Sleep 500ms
Enter
Sleep 6s
