#!/bin/bash

echo "🔧 Создаем приложение с автопоиском Node.js..."

cd /Users/gruppav/Desktop/creative-dashboard

# Удаляем старое приложение
rm -rf "Creative Dashboard.app"

# Создаем структуру
mkdir -p "Creative Dashboard.app/Contents/MacOS"
mkdir -p "Creative Dashboard.app/Contents/Resources"

# Создаем супер-умный исполняемый файл
cat > "Creative Dashboard.app/Contents/MacOS/Creative Dashboard" << 'EOF'
#!/bin/bash

# Логирование
exec > /tmp/creative-dashboard-debug.log 2>&1
echo "=== Creative Dashboard Debug Log ==="
echo "Время: $(date)"
echo "Текущий PATH: $PATH"

# Функция поиска Node.js в разных местах
find_nodejs() {
    echo "🔍 Ищем Node.js..."
    
    # Стандартные места установки Node.js
    POSSIBLE_PATHS=(
        "/usr/local/bin"
        "/opt/homebrew/bin"
        "/usr/bin"
        "/opt/local/bin"
        "$HOME/.nvm/versions/node/*/bin"
        "/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Resources"
    )
    
    # Проверяем каждое возможное место
    for path in "${POSSIBLE_PATHS[@]}"; do
        # Обрабатываем wildcards для nvm
        for expanded_path in $path; do
            if [ -f "$expanded_path/node" ] && [ -f "$expanded_path/npm" ]; then
                echo "✅ Найден Node.js в: $expanded_path"
                export PATH="$expanded_path:$PATH"
                return 0
            fi
        done
    done
    
    # Проверяем через Terminal.app (получаем PATH из терминала)
    TERMINAL_PATH=$(osascript -e 'tell application "Terminal" to do script "echo $PATH" in window 1' 2>/dev/null | tail -n 1)
    if [ ! -z "$TERMINAL_PATH" ]; then
        echo "📍 PATH из Terminal: $TERMINAL_PATH"
        export PATH="$TERMINAL_PATH"
        if command -v node &> /dev/null && command -v npm &> /dev/null; then
            echo "✅ Node.js найден через Terminal PATH"
            return 0
        fi
    fi
    
    return 1
}

# Расширенный PATH
export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/opt/local/bin:$HOME/.nvm/versions/node/*/bin:$PATH"

# Пытаемся найти Node.js
if ! command -v node &> /dev/null || ! command -v npm &> /dev/null; then
    echo "⚠️ Node.js не найден в стандартном PATH, ищем везде..."
    
    if ! find_nodejs; then
        echo "❌ Node.js не найден нигде!"
        osascript << 'APPLESCRIPT'
tell application "System Events"
    display dialog "Node.js не найден!

Пожалуйста:
1. Установите Node.js с https://nodejs.org
2. Перезагрузите компьютер
3. Попробуйте снова" buttons {"Открыть nodejs.org", "Отмена"} default button 1

    if result = {button returned:"Открыть nodejs.org"} then
        do shell script "open https://nodejs.org"
    end if
end tell
APPLESCRIPT
        exit 1
    fi
fi

# Проверяем версии
NODE_VERSION=$(node --version)
NPM_VERSION=$(npm --version)
echo "✅ Node.js версия: $NODE_VERSION"
echo "✅ npm версия: $NPM_VERSION"

# Переходим в проект
PROJECT_DIR="/Users/gruppav/Desktop/creative-dashboard"
cd "$PROJECT_DIR"

# Проверяем проект
if [ ! -f "package.json" ]; then
    echo "❌ package.json не найден!"
    osascript -e 'display alert "Ошибка" message "Файл package.json не найден в папке creative-dashboard!" buttons {"OK"}'
    exit 1
fi

# Устанавливаем зависимости если нужно
if [ ! -d "node_modules" ]; then
    echo "📦 Устанавливаем зависимости..."
    osascript -e 'display notification "Устанавливаем зависимости..." with title "Creative Dashboard"'
    npm install
fi

# Уведомление о запуске
osascript -e 'display notification "Запускаем дэшборд..." with title "Creative Dashboard"'

echo "🚀 Запускаем сервер..."

# Запускаем в отдельном окне терминала
osascript << APPLESCRIPT
tell application "Terminal"
    do script "cd '$PROJECT_DIR' && echo '🎉 Creative Dashboard запускается...' && echo '🌐 Откроется на http://localhost:3000' && echo '' && npm start"
    activate
end tell
APPLESCRIPT

echo "✅ Дэшборд запущен!"
EOF

# Права доступа
chmod +x "Creative Dashboard.app/Contents/MacOS/Creative Dashboard"

# Info.plist
cat > "Creative Dashboard.app/Contents/Info.plist" << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key>
    <string>Creative Dashboard</string>
    <key>CFBundleIdentifier</key>
    <string>com.creativedashboard.app</string>
    <key>CFBundleName</key>
    <string>Creative Dashboard</string>
    <key>CFBundleDisplayName</key>
    <string>Creative Dashboard</string>
    <key>CFBundleVersion</key>
    <string>1.0</string>
    <key>CFBundleShortVersionString</key>
    <string>1.0</string>
    <key>LSMinimumSystemVersion</key>
    <string>10.13</string>
    <key>NSHighResolutionCapable</key>
    <true/>
</dict>
</plist>
EOF

echo ""
echo "🎉 Умное приложение создано!"
echo "🔍 Теперь оно автоматически найдет Node.js везде"
echo ""
echo "📋 Что делает новая версия:"
echo "   ✅ Ищет Node.js в 6+ стандартных местах"
echo "   ✅ Получает PATH из Terminal.app"  
echo "   ✅ Показывает детальный лог в /tmp/creative-dashboard-debug.log"
echo "   ✅ Предлагает скачать Node.js если не найден"
echo ""
echo "🚀 Попробуйте запустить приложение!"