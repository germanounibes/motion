<div align="center">

<img src="icons/icon.svg" alt="Motion Studio" width="120" />

# Motion Studio

**Anime servomotores como se estivesse editando um vídeo.**

Uma linha do tempo com keyframes, curvas de movimento e play. O resultado sai direto para o seu Arduino Mega por USB, do computador ou do celular.

![PWA](https://img.shields.io/badge/PWA-instal%C3%A1vel-6c4fe0?style=flat-square)
![Offline](https://img.shields.io/badge/funciona-offline-3ff0c8?style=flat-square&labelColor=241a4d)
![Arduino Mega](https://img.shields.io/badge/Arduino-Mega-00979d?style=flat-square&logo=arduino&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-sem%20build-f7df1e?style=flat-square&logo=javascript&logoColor=black)
![Web Serial](https://img.shields.io/badge/Web%20Serial-WebUSB-4285f4?style=flat-square&logo=googlechrome&logoColor=white)

</div>

---

## Por quê?

Fazer um servo se mexer é fácil. Fazer **doze servos se moverem juntos, com ritmo e suavidade**, escrevendo ângulos e `delay()` no código, é um sofrimento.

O Motion Studio troca isso por uma interface que quem já editou vídeo reconhece: você posiciona o playhead, ajusta os servos, aperta **K** para criar um keyframe, e o programa calcula todo o movimento entre eles. Dá play e o Arduino obedece, em tempo real.

Serve para robôs, animatrônicos, olhos mecânicos, braços articulados, instalações interativas: qualquer coisa que se mexa com servos.

## O que ele faz

| | |
|---|---|
| 🎞️ **Linha do tempo** | Keyframes, playhead com snapping, zoom e ajuste à janela |
| 📈 **Interpolação por keyframe** | Linear, Ease In, Ease Out, Ease In-Out ou Hold (mantém a posição) |
| 🎛️ **Mostradores ao vivo** | Veja o ângulo de cada servo enquanto edita e reproduz |
| 🦾 **Até 12 servos** | Cada um com seu pino e sua cor |
| 👆 **Toque, mouse e teclado** | Arrastar, pinça para zoom no celular, `Ctrl + roda` no desktop |
| ↩️ **Desfazer / refazer** | Errou? `Ctrl+Z` |
| 🔁 **Loop e duração automática** | Prévia contínua do trecho que você está ajustando |
| 💾 **Autosave e presets** | Nada se perde. Importe e exporte em JSON |
| 🔌 **USB direto do navegador** | Web Serial nativo, com WebUSB como reserva |
| 📱 **Instalável e offline** | Abre do ícone na tela inicial, sem internet |
| 👀 **Modo prévia** | Dá para animar sem ter o Arduino conectado |

## Como funciona

```
 ┌──────────────┐    keyframes    ┌──────────────┐    ~30 Hz    ┌─────────────┐
 │  Timeline    │ ──────────────▶ │ Interpolação │ ───────────▶ │ Arduino Mega│ ──▶ servos
 │  (você edita)│                 │ (ease, hold) │  USB serial  │             │
 └──────────────┘                 └──────────────┘              └─────────────┘
```

O app interpola os ângulos entre os keyframes e envia as posições a cerca de 30 vezes por segundo. O Arduino só precisa entender três comandos de texto simples.

## Começando

### 1. Rodar

```bash
cd motion-pwa
python3 -m http.server 8765
```

Abra **http://localhost:8765** no Chrome ou Edge.

### 2. Conectar o Arduino

1. Ligue o Mega por USB.
2. Clique em conectar e escolha a porta.
3. Atribua um pino a cada servo.
4. Crie keyframes e aperte play.

### 3. Usar no celular

Publique a pasta em qualquer host **HTTPS** (GitHub Pages, Netlify...). Abra no Chrome do Android, use **Adicionar à tela inicial** e ligue o Mega por um cabo **USB OTG**.

> **Compatibilidade:** placas originais (`0x2341`), Arduino SRL (`0x2a03`) e **clones com chip CH340** (`0x1a86`) funcionam
> pelo WebUSB, inclusive no celular. O CH340 usa um driver próprio em `js/ch340.js`, porque o polyfill do Google só abre chips CDC-ACM.
> No Android o app já escolhe o modo WebUSB sozinho.

## Atalhos

| Tecla | Ação |
|---|---|
| `Espaço` | Play / Pause |
| `K` | Criar keyframe no playhead |
| `Del` | Remover keyframe |
| `Ctrl+Z` / `Ctrl+Y` | Desfazer / refazer |
| `L` | Loop |
| `Ctrl + roda` | Zoom na timeline |

## Firmware do Arduino

O Mega precisa de um sketch que entenda os comandos do app. Ele está em [`firmware/motion_firmware/motion_firmware.ino`](firmware/motion_firmware/motion_firmware.ino).

1. Abra o arquivo na **Arduino IDE**.
2. Em **Ferramentas → Placa**, escolha **Arduino Mega or Mega 2560**.
3. Escolha a porta e clique em **Carregar**.

Só usa a biblioteca `Servo`, que já vem com a IDE. Você grava uma vez e depois é só usar o app.

**Ligação dos servos:** sinal (laranja/amarelo) no pino escolhido no app (2 a 53), GND no GND. Alimente os servos com uma **fonte externa de 5 V** (o GND dela precisa ir junto com o GND do Arduino). Vários servos puxando corrente da USB podem travar ou reiniciar a placa.

## Protocolo serial

Texto puro, 115200 baud, uma linha por comando (`\n`):

| Comando | Efeito |
|---|---|
| `ATTACH,<id>,<pino>` | Liga o servo `<id>` ao pino |
| `MOVE,<id>,<valor>` | Move o servo para a posição |
| `DETACH,<id>` | Solta o servo |

O Arduino reinicia ao abrir a porta, então o app espera cerca de 1,8 s antes de enviar.

## Por dentro

Sem framework e sem etapa de build: JavaScript puro em módulos ES.

```
index.html · manifest.webmanifest · sw.js    PWA e service worker (offline)
js/store.js      estado, keyframes, interpolação, reprodução, desfazer/refazer
js/link.js       conexão serial e protocolo
js/ch340.js      driver WebUSB do chip CH340 (clones do Arduino)
js/timeline.js   linha do tempo (toque, pinça, mouse)
js/viewer.js     mostradores
js/storage.js    IndexedDB (presets e autosave)
js/app.js        interface
vendor/          web-serial-polyfill.js (Google)
firmware/        sketch do Arduino Mega
test/            testes de lógica e de interface
```

### Testes

- `test/logic.html`: abra no navegador, servido pelo `http.server`
- `test/ui_test.py` e `test/ui_test2.py`: dirigem o Chromium via DevTools

## Versão desktop

O projeto nasceu como `motion.py`, um app desktop em Python/Tkinter (`pyserial` opcional), com as mesmas funções e o mesmo protocolo. Os presets são compatíveis entre as duas versões (`servo_presets_mega.json`).

---

<div align="center">
Feito para dar vida a coisas que se mexem. 🤖
</div>
