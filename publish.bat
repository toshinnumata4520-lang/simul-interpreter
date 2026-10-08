@echo off
rem Create a public GitHub repo and enable GitHub Pages (run once)
cd /d "%~dp0"
gh repo create simul-interpreter --public --source . --push || goto :err
gh api -X POST repos/toshinnumata4520-lang/simul-interpreter/pages -f "source[branch]=main" -f "source[path]=/" || goto :err
echo.
echo Published. In 1-2 minutes, open this URL in Safari on your iPhone:
echo https://toshinnumata4520-lang.github.io/simul-interpreter/
pause
exit /b 0
:err
echo An error occurred.
pause
exit /b 1
