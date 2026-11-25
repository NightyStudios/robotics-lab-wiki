# Как запустить вики SO‑101

## Локальный запуск

Нужны Node.js 20.11 или новее и npm. Запусти из корня `robotics-lab`. [Требование Node.js](https://nodejs.org/api/esm.html#importmetadirname)

```sh
cd web-proto
npm ci
npm start
```

Открой [каталог статей](http://127.0.0.1:4173/#/wiki). Сервер работает на твоём компьютере, пока открыт терминал. Чтобы остановить его, нажми `Ctrl+C`. Для повторного запуска достаточно `npm start` из `web-proto`.

Если вики уже запущена, просто открой каталог. Если порт `4173` занят другим приложением, запусти вики на [порту 4174](http://127.0.0.1:4174/#/wiki).

```sh
PORT=4174 npm start
```

## Развёртывание на GitHub Pages

В настройках репозитория открой **Settings → Pages** и выбери **GitHub Actions** в поле **Source**. [Документация GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)

[Workflow публикации](../.github/workflows/pages.yml) собирает сайт при пуше в `main` и передаёт в Pages содержимое `web-proto/dist`. Адрес сайта появится в **Settings → Pages** после успешной публикации.

Клади статьи и картинки рядом, в папку `guides/` в корне репозитория. Например, в `guides/nano.md` можно сослаться на `guides/nano.png` через `![Редактор nano](nano.png)`. Добавь оба файла в коммит и запушь его в `main`, чтобы сайт обновился.

## Развёртывание на nginx

Собери вики из корня `robotics-lab`. Готовые файлы появятся в `web-proto/dist`.

```sh
cd web-proto
npm ci
npm run build
```

Перенеси содержимое `dist` на сервер. Если собираешь на том же сервере, из папки `web-proto` выполни эти команды.

```sh
sudo install -d -m 0755 /var/www/so101
sudo cp -a dist/. /var/www/so101/
```

Если собираешь на другой машине, передай файлы любым удобным способом. На сервере должен появиться `/var/www/so101/index.html`. Node.js нужен только на машине, где выполняешь сборку.

Если на сервере Ubuntu ещё нет nginx, установи его. [Инструкция Ubuntu](https://ubuntu.com/server/docs/how-to/web-services/install-nginx/)

```sh
sudo apt update
sudo apt install nginx
```

Для нового сайта сохрани блок ниже в `/etc/nginx/sites-available/so101`. Замени `wiki.example.org` своим доменом или IP-адресом. Если для сайта уже настроен HTTPS, перенеси `root`, `index` и блоки `location` в существующий `server`. [Документация nginx по спискам каталогов](https://nginx.org/en/docs/http/ngx_http_autoindex_module.html)

```nginx
server {
    listen 80;
    server_name wiki.example.org;
    root /var/www/so101;
    index index.html;

    location / {
        try_files $uri $uri/ =404;
    }

    location = /guides/index.json {
        rewrite ^ /guides/ last;
    }

    location = /guides/ {
        internal;
        autoindex on;
        autoindex_format json;
        add_header Cache-Control "no-cache" always;
    }

    location ~* ^/guides/[^./][^/]*\.(md|markdown)$ {
        default_type text/plain;
        add_header Cache-Control "no-cache" always;
        try_files $uri =404;
    }

    location ~* ^/guides/[^./][^/]*\.(avif|gif|jpe?g|png|webp)$ {
        types {
            image/avif avif;
            image/gif gif;
            image/jpeg jpg jpeg;
            image/png png;
            image/webp webp;
        }
        add_header Cache-Control "no-cache" always;
        try_files $uri =404;
    }

    location /guides/ {
        return 404;
    }
}
```

Если создал отдельный файл `sites-available/so101`, включи его один раз. [Настройка сайтов на Ubuntu](https://ubuntu.com/server/docs/how-to/web-services/configure-nginx/)

```sh
sudo ln -s /etc/nginx/sites-available/so101 /etc/nginx/sites-enabled/so101
```

Проверь конфигурацию и примени её.

```sh
sudo nginx -t && sudo systemctl reload nginx
```

Открой свой домен или IP в браузере. Если каталог пуст, проверь `/guides/index.json` на том же адресе. В ответе должен быть список файлов из `/var/www/so101/guides`.

## Как добавлять статьи

Клади `.md` или `.markdown` прямо в папку статей. Заголовок первого уровня станет названием новой ветки в каталоге.

Примеры разметки собраны в [минигайде по написанию статей](./WRITING-GUIDES.md).

- При локальном запуске используй `robotics-lab/guides` и обнови страницу.
- На nginx с конфигурацией выше используй `/var/www/so101/guides` и обнови страницу. Пересборка и перезапуск для новых статей не нужны.
- На хостинге готовых файлов используй `robotics-lab/guides`, затем повтори `npm run build` и публикацию `dist`. Список статей берётся из `dist/guides/index.json`.

Клавиши помечай через `<kbd>Enter</kbd>`, а сочетания записывай как `<kbd>Ctrl</kbd> + <kbd>O</kbd>`. Для блока с одним выводом терминала используй метку `console-output`. В сеансе оболочки с приглашением `$` или `%` подсветка применяется к командам после приглашения.

## Как добавлять картинки

Положи PNG, JPEG, GIF, WebP или AVIF рядом с файлом статьи в `guides` и вставь в Markdown ссылку по имени файла.

```md
![Редактор nano с открытым файлом](nano.png)
![Схема подключения](<Схема подключения.png>)
![Золотая рыбка смотрит в камеру](fish-meme.webp "Я ничего не понял. Я рыба.")
```

Имена с пробелами оборачивай в угловые скобки. Для картинок, опубликованных в интернете, указывай прямую HTTPS-ссылку.

Чтобы показать подпись под картинкой, вынеси её в отдельный абзац и добавь текст подписи в кавычках после имени файла. В квадратных скобках оставь описание изображения.

При локальном запуске достаточно обновить страницу. Статическая сборка копирует картинки в `dist/guides` вместе со статьями. На nginx можно класть их прямо в `/var/www/so101/guides`. Для существующего nginx добавь блок для изображений из примера выше и один раз проверь и перезагрузи конфигурацию.

Решения по интерфейсу и результаты проверки описаны в [DESIGN.md](./DESIGN.md). Тема сайта и подсветка используют цвета [Lucario](https://github.com/raphamorim/lucario).
