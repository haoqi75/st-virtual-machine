(async function(Scratch) {
    'use strict';
    const xtermStyle = document.createElement('link');
    xtermStyle.rel = 'stylesheet';
    xtermStyle.href = 'https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/css/xterm.min.css';
    document.head.appendChild(xtermStyle);

    const { Terminal } = await import('https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/+esm');
    const { FitAddon } = await import('https://cdn.jsdelivr.net/npm/@xterm/addon-fit@0.10.0/+esm');
    const { WebLinksAddon } = await import('https://cdn.jsdelivr.net/npm/@xterm/addon-web-links@0.11.0/+esm');
    const { CanvasAddon } = await import('https://cdn.jsdelivr.net/npm/@xterm/addon-canvas@0.7.0/+esm');

    const loadV86 = () => {
        return new Promise((resolve, reject) => {
            if (typeof V86 !== 'undefined') {
                resolve();
                return;
            }
            
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/v86@0.5.66/build/libv86.js';
            script.onload = () => {
                console.log('V86 emulator loaded successfully');
                resolve();
            };
            script.onerror = (error) => {
                console.error('Failed to load v86:', error);
                reject(new Error('Failed to load v86'));
            };
            document.head.appendChild(script);
        });
    };

    try {
        await loadV86();
    } catch (error) {
        console.error('V86 loading failed:', error);
    }

    const runtime = Scratch.vm.runtime;

    class VMExtension {
        constructor() {
            this.vm = null;
            this.terminal = null;
            this.fitAddon = null;
            this.canvasAddon = null;
            this.webLinksAddon = null;
            this.vmContainer = null;
            this.terminalElement = null;
            this.isRunning = false;
            this.savedState = null;
            this.buffer = '';
            this.bufferEnabled = false;
            this.dataCallbacks = [];
            this.eventData = {};
            
            this.osImages = {
                'linux': 'https://copy.sh/v86/images/linux26.img',
                'freedos': 'https://cdn.milosantos.com/freedos722.img',
                'openbsd': 'https://copy.sh/v86/images/openbsd.img',
                'kolibri': 'https://copy.sh/v86/images/kolibri.img',
                'dsl': 'https://cdn.milosantos.com/dsl-4.11.rc2.iso',
                'windows7': 'https://cdn.milosantos.com/Win7.iso'
            };
            
            this.initializeStyles();
            this.initializeTerminal();
        }

        initializeStyles() {
            const style = document.createElement('style');
            style.textContent = `
                .vm-extension-container {
                    position: fixed;
                    top: 50px;
                    left: 50px;
                    width: 900px;
                    height: 700px;
                    background: #1a1a1a;
                    border: 2px solid #333;
                    border-radius: 8px;
                    box-shadow: 0 8px 32px rgba(0,0,0,0.5);
                    z-index: 10000;
                    display: none;
                    flex-direction: column;
                    font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
                }
                
                .vm-header {
                    background: linear-gradient(135deg, #FF6B35, #F7931E);
                    color: white;
                    padding: 10px 15px;
                    font-size: 14px;
                    font-weight: bold;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    border-radius: 6px 6px 0 0;
                    user-select: none;
                    cursor: move;
                }
                
                .vm-controls {
                    display: flex;
                    gap: 8px;
                }
                
                .vm-control-btn {
                    width: 12px;
                    height: 12px;
                    border-radius: 50%;
                    border: none;
                    cursor: pointer;
                    transition: opacity 0.2s;
                }
                
                .vm-control-btn:hover {
                    opacity: 0.8;
                }
                
                .vm-close { background: #ff5f56; }
                .vm-minimize { background: #ffbd2e; }
                .vm-maximize { background: #27ca3f; }
                
                .vm-content {
                    flex: 1;
                    display: flex;
                    flex-direction: column;
                }
                
                .vm-screen-area {
                    flex: 1;
                    background: #000;
                    position: relative;
                    min-height: 400px;
                    border-bottom: 1px solid #333;
                    overflow: hidden;
                }

                #vm-screen {
                    width: 100% !important;
                    height: 100% !important;
                    object-fit: contain;
                    image-rendering: pixelated;
                }
                .vm-terminal-area {
                    height: 200px;
                    background: #1a1a1a;
                    position: relative;
                }
                
                .vm-status-bar {
                    background: #2a2a2a;
                    color: #ccc;
                    padding: 4px 15px;
                    font-size: 11px;
                    border-radius: 0 0 6px 6px;
                    display: flex;
                    justify-content: space-between;
                }
                
                .vm-status-indicator {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                }
                
                .vm-status-dot {
                    width: 8px;
                    height: 8px;
                    border-radius: 50%;
                    background: #27ca3f;
                    animation: pulse 2s infinite;
                }
                
                @keyframes pulse {
                    0%, 100% { opacity: 1; }
                    50% { opacity: 0.5; }
                }
                
                .xterm-viewport.xterm-viewport {
                    scrollbar-width: none;
                }
                .xterm-viewport::-webkit-scrollbar {
                    width: 0;
                }
            `;
            document.head.appendChild(style);
        }

        makeDraggable(container, handle) {
            let isDragging = false;
            let offsetX = 0, offsetY = 0;

            handle.addEventListener('mousedown', (e) => {
                isDragging = true;
                offsetX = e.clientX - container.offsetLeft;
                offsetY = e.clientY - container.offsetTop;

                e.preventDefault();

                const onMouseMove = (e) => {
                    if (!isDragging) return;
                    
                    let newX = e.clientX - offsetX;
                    let newY = e.clientY - offsetY;
                    
                    const maxX = window.innerWidth - container.offsetWidth;
                    const maxY = window.innerHeight - container.offsetHeight;
                    
                    newX = Math.max(0, Math.min(newX, maxX));
                    newY = Math.max(0, Math.min(newY, maxY));
                    
                    container.style.left = `${newX}px`;
                    container.style.top = `${newY}px`;
                };

                const onMouseUp = () => {
                    isDragging = false;
                    document.removeEventListener('mousemove', onMouseMove);
                    document.removeEventListener('mouseup', onMouseUp);
                };

                document.addEventListener('mousemove', onMouseMove);
                document.addEventListener('mouseup', onMouseUp);
            });

            const controlButtons = handle.querySelectorAll('.vm-control-btn');
            controlButtons.forEach(button => {
                button.addEventListener('mousedown', (e) => {
                    e.stopPropagation();
                });
            });
        }

        initializeTerminal() {
            this.terminal = new Terminal({
                cols: 80,
                rows: 12,
                allowTransparency: true,
                fontFamily: '"JetBrains Mono", "Fira Code", "Monaco", "Menlo", "Ubuntu Mono", monospace',
                fontSize: 13,
                lineHeight: 1.2,
                cursorBlink: true,
                theme: {
                    foreground: '#F8F8F8',
                    background: 'rgba(26,26,26,0.95)',
                    selection: '#5DA5D533',
                    black: '#1E1E1D',
                    brightBlack: '#262625',
                    red: '#CE5C5C',
                    brightRed: '#FF7272',
                    green: '#5BCC5B',
                    brightGreen: '#72FF72',
                    yellow: '#CCCC5B',
                    brightYellow: '#FFFF72',
                    blue: '#5D5DD3',
                    brightBlue: '#7279FF',
                    magenta: '#BC5ED1',
                    brightMagenta: '#E572FF',
                    cyan: '#5DA5D5',
                    brightCyan: '#72F0FF',
                    white: '#F8F8F8',
                    brightWhite: '#FFFFFF',
                    cursor: '#00ff00',
                    cursorAccent: '#000000'
                },
                allowProposedApi: true,
            });

            this.terminal.onData((data) => {
                if (this.dataCallbacks.length > 0) {
                    for (const callback of this.dataCallbacks) {
                        callback(this.buffer + data);
                    }
                    this.buffer = '';
                    this.dataCallbacks = [];
                } else if (this.bufferEnabled) {
                    this.buffer += data;
                }

                if (this.vm && this.vm.bus) {
                    for (let i = 0; i < data.length; i++) {
                        this.vm.bus.send("keyboard-code", data.charCodeAt(i));
                    }
                }
            });

            this.terminal.onResize(() => {
                runtime.startHats("vmextension_whenTerminalResized");
            });

            this.fitAddon = new FitAddon();
            this.canvasAddon = new CanvasAddon();
            this.webLinksAddon = new WebLinksAddon();
            
            this.terminal.loadAddon(this.fitAddon);
            this.terminal.loadAddon(this.canvasAddon);
            this.terminal.loadAddon(this.webLinksAddon);
        }

        _initializeVMContainer() {
            if (this.vmContainer) return;

            this.vmContainer = document.createElement('div');
            this.vmContainer.className = 'vm-extension-container';
            this.vmContainer.innerHTML = `
                <div class="vm-header">
                    <span>🖥️ Virtual Machine</span>
                    <div class="vm-controls">
                        <button class="vm-control-btn vm-minimize" title="Minimize"></button>
                        <button class="vm-control-btn vm-maximize" title="Maximize"></button>
                        <button class="vm-control-btn vm-close" title="Close"></button>
                    </div>
                </div>
                <div class="vm-content">
                    <div id="screen_container" class="vm-screen-area">
                        <div id="screen"></div>
                        <canvas id="vga"></canvas>
                        <div style="position: absolute; top: 0; z-index: 10; display: none">
                            <textarea class="phone_keyboard"></textarea>
                        </div>
                    </div>
                    <div class="vm-terminal-area" id="vm-terminal" style="display: none"></div>
                </div>
                <div class="vm-status-bar">
                    <div class="vm-status-indicator">
                        <div class="vm-status-dot"></div>
                        <span id="vm-status-text">Ready</span>
                    </div>
                    <span id="vm-os-info">No OS loaded</span>
                </div>
            `;

            document.body.appendChild(this.vmContainer);

            this.vmContainer.querySelector('.vm-close').onclick = () => this.hideVM();
            this.vmContainer.querySelector('.vm-minimize').onclick = () => this.minimizeVM();
            this.vmContainer.querySelector('.vm-maximize').onclick = () => this.maximizeVM();

            const vmHeader = this.vmContainer.querySelector('.vm-header');
            this.makeDraggable(this.vmContainer, vmHeader);

            this.terminalElement = this.vmContainer.querySelector('#vm-terminal');
            this.terminal.open(this.terminalElement);
            this.terminal._core.viewport.scrollBarWidth = 0;
            this.fitAddon.fit();
        }

        getInfo() {
            return {
                id: 'vmextension',
                name: 'Virtual Machine',
                color1: '#FF6B35',
                color2: '#F7931E',
                color3: '#FFD23F',
                blocks: [
                    {
                        opcode: 'startVM',
                        blockType: Scratch.BlockType.COMMAND,
                        text: 'start virtual machine with OS [OS]',
                        arguments: {
                            OS: {
                                type: Scratch.ArgumentType.STRING,
                                menu: 'osMenu',
                                defaultValue: 'linux'
                            }
                        }
                    },
                    {
                        opcode: 'stopVM',
                        blockType: Scratch.BlockType.COMMAND,
                        text: 'stop virtual machine'
                    },
                    {
                        opcode: 'showVM',
                        blockType: Scratch.BlockType.COMMAND,
                        text: 'show VM at x: [X] y: [Y] width: [WIDTH] height: [HEIGHT]',
                        arguments: {
                            X: { type: Scratch.ArgumentType.NUMBER, defaultValue: 100 },
                            Y: { type: Scratch.ArgumentType.NUMBER, defaultValue: 100 },
                            WIDTH: { type: Scratch.ArgumentType.NUMBER, defaultValue: 900 },
                            HEIGHT: { type: Scratch.ArgumentType.NUMBER, defaultValue: 700 }
                        }
                    },
                    {
                        opcode: 'hideVM',
                        blockType: Scratch.BlockType.COMMAND,
                        text: 'hide virtual machine'
                    },
                    {
                        opcode: 'changeVisibility',
                        blockType: Scratch.BlockType.COMMAND,
                        text: '[STATUS] virtual machine',
                        arguments: {
                            STATUS: {
                                type: Scratch.ArgumentType.STRING,
                                menu: 'visibilityMenu',
                                defaultValue: 'show'
                            }
                        }
                    },
                    '---',
                    {
                        opcode: 'print',
                        blockType: Scratch.BlockType.COMMAND,
                        text: 'print [INFO] with [NEWLINE]',
                        arguments: {
                            INFO: { type: Scratch.ArgumentType.STRING, defaultValue: 'Hello World!' },
                            NEWLINE: {
                                type: Scratch.ArgumentType.STRING,
                                menu: 'newlineMenu',
                                defaultValue: 'newline'
                            }
                        }
                    },
                    {
                        opcode: 'sendCommand',
                        blockType: Scratch.BlockType.COMMAND,
                        text: 'send command [COMMAND]',
                        arguments: {
                            COMMAND: { type: Scratch.ArgumentType.STRING, defaultValue: 'ls' }
                        }
                    },
                    {
                        opcode: 'sendKeys',
                        blockType: Scratch.BlockType.COMMAND,
                        text: 'send keys [KEYS] to VM',
                        arguments: {
                            KEYS: { type: Scratch.ArgumentType.STRING, defaultValue: 'hello' }
                        }
                    },
                    {
                        opcode: 'clear',
                        blockType: Scratch.BlockType.COMMAND,
                        text: 'clear [CLEARTYPE]',
                        arguments: {
                            CLEARTYPE: {
                                type: Scratch.ArgumentType.STRING,
                                menu: 'clearMenu',
                                defaultValue: 'screen'
                            }
                        }
                    },
                    {
                        opcode: 'moveCursorTo',
                        blockType: Scratch.BlockType.COMMAND,
                        text: 'move cursor to x: [X] y: [Y]',
                        arguments: {
                            X: { type: Scratch.ArgumentType.NUMBER, defaultValue: 0 },
                            Y: { type: Scratch.ArgumentType.NUMBER, defaultValue: 0 }
                        }
                    },
                    '---',
                    {
                        opcode: 'isVMRunning',
                        blockType: Scratch.BlockType.BOOLEAN,
                        text: 'is virtual machine running?'
                    },
                    {
                        opcode: 'getVMStatus',
                        blockType: Scratch.BlockType.REPORTER,
                        text: 'VM status'
                    },
                    {
                        opcode: 'get',
                        blockType: Scratch.BlockType.REPORTER,
                        text: 'get terminal input'
                    },
                    {
                        opcode: 'screenOptions',
                        blockType: Scratch.BlockType.REPORTER,
                        text: 'terminal [SCREENOPTION]',
                        arguments: {
                            SCREENOPTION: {
                                type: Scratch.ArgumentType.STRING,
                                menu: 'screenOptionsMenu',
                                defaultValue: 'size'
                            }
                        }
                    },
                    '---',
                    {
                        opcode: 'saveState',
                        blockType: Scratch.BlockType.COMMAND,
                        text: 'save VM state'
                    },
                    {
                        opcode: 'loadState',
                        blockType: Scratch.BlockType.COMMAND,
                        text: 'load VM state'
                    },
                    '---',
                    {
                        opcode: 'coloredText',
                        blockType: Scratch.BlockType.REPORTER,
                        text: '[TEXT] with [COLOR] [TYPE]',
                        arguments: {
                            TEXT: { type: Scratch.ArgumentType.STRING, defaultValue: 'Hello!' },
                            COLOR: { type: Scratch.ArgumentType.COLOR, defaultValue: '#ff0000' },
                            TYPE: {
                                type: Scratch.ArgumentType.STRING,
                                menu: 'colorTypeMenu',
                                defaultValue: 'foreground'
                            }
                        }
                    }
                ],
                menus: {
                    osMenu: {
                        acceptReporters: true,
                        items: [
                            { text: 'Linux 2.6', value: 'linux' },
                            { text: 'FreeDOS', value: 'freedos' },
                            { text: 'OpenBSD', value: 'openbsd' },
                            { text: 'KolibriOS', value: 'kolibri' },
                            { text: 'Damn Small Linux', value: 'dsl' },
                            { text: 'Windows 7', value: 'windows7'}
                        ]
                    },
                    visibilityMenu: {
                        acceptReporters: false,
                        items: ['show', 'hide']
                    },
                    newlineMenu: {
                        acceptReporters: false,
                        items: ['newline', 'no newline']
                    },
                    clearMenu: {
                        acceptReporters: false,
                        items: ['screen', 'after', 'before', 'scrollback']
                    },
                    screenOptionsMenu: {
                        acceptReporters: false,
                        items: ['size', 'cursor']
                    },
                    colorTypeMenu: {
                        acceptReporters: false,
                        items: ['foreground', 'background']
                    }
                }
            };
        }

        async startVM(args) {
            if (this.isRunning) {
                await this.stopVM();
            }

            if (typeof V86 === 'undefined') {
                console.error('V86 emulator not available');
                return;
            }

            try {
                this._initializeVMContainer();
                await this.initializeVM(args.OS);
            } catch (error) {
                console.error('Failed to start VM:', error);
                this.updateStatus('Error: Failed to start VM', false);
            }
        }

        async initializeVM(osType) {
            this.updateStatus(`Starting ${osType}...`, true);

            try {
                this.vm = new V86({
                    wasm_path: "https://cdn.jsdelivr.net/npm/v86@0.5.66/build/v86.wasm",
                    acpi: true,
                    memory_size: 2048 * 1024 * 1024, // 2048MB (2GB)
                    vga_memory_size: 256 * 1024 * 1024, // 256MB
                    screen_container: document.getElementById("screen_container"),
                    bios: {
                        url: "https://raw.githubusercontent.com/copy/v86/refs/heads/master/bios/seabios.bin",
                    },
                    vga_bios: {
                        url: "https://raw.githubusercontent.com/copy/v86/refs/heads/master/bios/vgabios.bin",
                    },
                    cdrom: {
                        url: this.osImages[osType] || this.osImages['linux'],
                    },
                    boot_order: 0x123,
                    autostart: true,
                });

                this.vm.add_listener("serial0-output-byte", (byte) => {
                    if (this.terminal) {
                        this.terminal.write(String.fromCharCode(byte));
                    }
                });

                this.isRunning = true;
                this.updateStatus(`Running ${osType}`, true);
                this.updateOSInfo(osType.toUpperCase());

                this.terminal.clear();
                this.terminal.writeln('\x1b[1;32m╔══════════════════════════════════════════════════════════════════════════════╗\x1b[0m');
                this.terminal.writeln('\x1b[1;32m║                           🖥️  VIRTUAL MACHINE TERMINAL                        ║\x1b[0m');
                this.terminal.writeln('\x1b[1;32m╚══════════════════════════════════════════════════════════════════════════════╝\x1b[0m');
                this.terminal.writeln('');
                this.terminal.writeln(`\x1b[1;36mOS: ${osType.toUpperCase()}\x1b[0m`);
                this.terminal.writeln('\x1b[33mVM is booting up... This may take a moment.\x1b[0m');
                this.terminal.writeln('\x1b[97mUse the graphical interface above or type commands here.\x1b[0m');
                this.terminal.writeln('');
                this.terminal.write('\x1b[1;32m$ \x1b[0m');

            } catch (error) {
                console.error('VM initialization failed:', error);
                this.updateStatus('Failed to initialize', false);
                throw error;
            }
        }

        updateStatus(text, isRunning) {
            if (!this.vmContainer) return;
            
            const statusText = this.vmContainer.querySelector('#vm-status-text');
            const statusDot = this.vmContainer.querySelector('.vm-status-dot');
            
            if (statusText) statusText.textContent = text;
            if (statusDot) {
                statusDot.style.background = isRunning ? '#27ca3f' : '#ff5f56';
            }
        }

        updateOSInfo(osName) {
            if (!this.vmContainer) return;
            
            const osInfo = this.vmContainer.querySelector('#vm-os-info');
            if (osInfo) osInfo.textContent = osName;
        }

        async stopVM() {
            if (this.vm) {
                try {
                    this.vm.stop();
                } catch (error) {
                    console.warn('Error stopping VM:', error);
                }
                this.vm = null;
            }

            this.isRunning = false;
            this.updateStatus('Stopped', false);
            this.updateOSInfo('No OS loaded');

            if (this.terminal) {
                this.terminal.clear();
                this.terminal.writeln('\x1b[1;31mVirtual Machine Stopped\x1b[0m');
            }
        }

        showVM(args) {
            this._initializeVMContainer();
            
            this.vmContainer.style.display = 'flex';
            this.vmContainer.style.left = `${args.X}px`;
            this.vmContainer.style.top = `${args.Y}px`;
            this.vmContainer.style.width = `${args.WIDTH}px`;
            this.vmContainer.style.height = `${args.HEIGHT}px`;

            setTimeout(() => {
                if (this.fitAddon) this.fitAddon.fit();
            }, 100);
        }

        hideVM() {
            if (this.vmContainer) {
                this.vmContainer.style.display = 'none';
            }
        }

        minimizeVM() {
            if (this.vmContainer) {
                this.vmContainer.style.transform = 'scale(0.1)';
                this.vmContainer.style.opacity = '0.5';
            }
        }

        maximizeVM() {
            if (this.vmContainer) {
                this.vmContainer.style.transform = 'scale(1)';
                this.vmContainer.style.opacity = '1';
                this.vmContainer.style.left = '50px';
                this.vmContainer.style.top = '50px';
                this.vmContainer.style.width = '90vw';
                this.vmContainer.style.height = '90vh';
                setTimeout(() => {
                    if (this.fitAddon) this.fitAddon.fit();
                }, 100);
            }
        }

        changeVisibility({ STATUS }) {
            STATUS = Scratch.Cast.toString(STATUS).toLowerCase();
            switch (STATUS) {
                case 'show':
                    if (this.vmContainer) {
                        this.vmContainer.style.display = 'flex';
                    } else {
                        this._initializeVMContainer();
                    }
                    break;
                case 'hide':
                    this.hideVM();
                    break;
            }
        }

        print({ INFO, NEWLINE }) {
            if (!this.terminal) return;
            
            NEWLINE = Scratch.Cast.toString(NEWLINE).toLowerCase();
            this.terminal[NEWLINE === 'newline' ? 'writeln' : 'write'](
                Scratch.Cast.toString(INFO)
            );
        }

        sendCommand(args) {
            if (!this.terminal) return;
            this.terminal.writeln(Scratch.Cast.toString(args.COMMAND));
        }

        sendKeys(args) {
            if (!this.vm || !this.vm.bus) return;
            
            const keys = Scratch.Cast.toString(args.KEYS);
            for (let i = 0; i < keys.length; i++) {
                this.vm.bus.send("keyboard-code", keys.charCodeAt(i));
            }
        }

        clear({ CLEARTYPE }) {
            if (!this.terminal) return;
            
            CLEARTYPE = Scratch.Cast.toString(CLEARTYPE).toLowerCase();
            const typeMap = {
                after: 0,
                before: 1,
                screen: 2,
                scrollback: 3,
            };
            
            if (CLEARTYPE in typeMap) {
                this.terminal.write(`\u001b[${typeMap[CLEARTYPE]}J`);
            }
        }

        moveCursorTo({ X, Y }) {
            if (!this.terminal) return;
            
            X = Scratch.Cast.toNumber(X);
            Y = Scratch.Cast.toNumber(Y);
            
            if (isFinite(X) && isFinite(Y) && Math.floor(X) === X && Math.floor(Y) === Y && X >= 0 && Y >= 0) {
                this.terminal.write(`\u001b[${Y + 1};${X + 1}H`);
            }
        }

        get() {
            return new Promise((resolve) => {
                this.dataCallbacks.push(resolve);
            });
        }

        screenOptions({ SCREENOPTION }) {
            if (!this.terminal) return '{}';
            
            SCREENOPTION = Scratch.Cast.toString(SCREENOPTION).toLowerCase();
            switch (SCREENOPTION) {
                case 'size':
                    return JSON.stringify({
                        x: this.terminal.cols,
                        y: this.terminal.rows,
                    });
                case 'cursor':
                    return JSON.stringify({
                        x: this.terminal._core._inputHandler._activeBuffer.x,
                        y: this.terminal._core._inputHandler._activeBuffer.y,
                    });
            }
            return '{}';
        }

        isVMRunning() {
            return this.isRunning;
        }

        getVMStatus() {
            if (!this.isRunning) return 'stopped';
            if (!this.vm) return 'starting';
            return 'running';
        }

        saveState() {
            if (!this.vm) {
                console.warn('No VM running to save state');
                return;
            }
            
            try {
                this.vm.save_state((error, state) => {
                    if (error) {
                        console.error('Failed to save state:', error);
                        this.terminal?.writeln('\x1b[1;31m[System] Failed to save VM state\x1b[0m');
                        return;
                    }
                    this.savedState = state;
                    console.log('VM state saved successfully');
                    this.terminal?.writeln('\x1b[1;33m[System] VM state saved\x1b[0m');
                });
            } catch (error) {
                console.error('Error saving VM state:', error);
            }
        }

        loadState() {
            if (!this.vm) {
                console.warn('No VM running to load state');
                return;
            }
            
            if (!this.savedState) {
                console.warn('No saved state found');
                this.terminal?.writeln('\x1b[1;31m[System] No saved state found\x1b[0m');
                return;
            }
            
            try {
                this.vm.restore_state(this.savedState);
                console.log('VM state restored successfully');
                this.terminal?.writeln('\x1b[1;33m[System] VM state restored\x1b[0m');
            } catch (error) {
                console.error('Error loading VM state:', error);
                this.terminal?.writeln('\x1b[1;31m[System] Failed to restore VM state\x1b[0m');
            }
        }

        coloredText({ TEXT, COLOR, TYPE }) {
            TYPE = Scratch.Cast.toString(TYPE).toLowerCase();
            COLOR = Scratch.Cast.toRgbColorList(COLOR);
            return `\u001b[${TYPE === 'background' ? '48' : '38'};2;${COLOR[0]};${COLOR[1]};${COLOR[2]}m${Scratch.Cast.toString(TEXT)}\u001b[0m`;
        }

        whenTerminalResized() {
            return true;
        }
    }

    Scratch.extensions.register(new VMExtension());
})(Scratch);
