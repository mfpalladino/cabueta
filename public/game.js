const socket = io();

let gameState = {
    playerId: null,
    players: [],
    gameStarted: false,
    gameEnded: false,
    timeLeft: 15
};

// Elementos DOM
const waitingScreen = document.getElementById('waitingScreen');
const gameArea = document.getElementById('gameArea');
const resultScreen = document.getElementById('resultScreen');
const messages = document.getElementById('messages');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const guessArea = document.getElementById('guessArea');
const guessButtons = document.getElementById('guessButtons');
const timer = document.getElementById('timer');
const playerStatus = document.getElementById('playerStatus');
const resultContent = document.getElementById('resultContent');
const restartBtn = document.getElementById('restartBtn');

// Timer
let timerInterval;

function updateTimer() {
    const minutes = Math.floor(gameState.timeLeft / 60);
    const seconds = gameState.timeLeft % 60;
    timer.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
    
    if (gameState.timeLeft <= 0) {
        clearInterval(timerInterval);
        showGuessArea();
    } else {
        gameState.timeLeft--;
    }
}

function startTimer() {
    gameState.timeLeft = 15;
    timerInterval = setInterval(updateTimer, 1000);
}

function showGuessArea() {
    guessArea.style.display = 'block';
    messageInput.disabled = true;
    sendBtn.disabled = true;
    
    // Criar botões para escolher o Cabueta
    guessButtons.innerHTML = '';
    gameState.players.forEach(player => {
        if (player.name !== 'Você') {
            const btn = document.createElement('button');
            btn.className = 'guess-btn';
            btn.textContent = player.name;
            btn.onclick = () => makeGuess(player.id);
            guessButtons.appendChild(btn);
        }
    });
}

function makeGuess(playerId) {
    socket.emit('makeGuess', playerId);
    guessArea.style.display = 'none';
}

function addMessage(message) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${message.playerId === gameState.playerId ? 'you' : 'other'}`;
    
    messageDiv.innerHTML = `
        <div class="message-header">${message.playerName} - ${message.timestamp}</div>
        <div>${message.text}</div>
    `;
    
    messages.appendChild(messageDiv);
    messages.scrollTop = messages.scrollHeight;
}

function sendMessage() {
    const text = messageInput.value.trim();
    if (text && gameState.gameStarted && !gameState.gameEnded) {
        socket.emit('sendMessage', { message: text });
        messageInput.value = '';
    }
}

// Event Listeners
messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        sendMessage();
    }
});

sendBtn.addEventListener('click', sendMessage);

restartBtn.addEventListener('click', () => {
    socket.emit('restartGame');
});

// Socket Events
socket.on('connect', () => {
    console.log('Conectado ao servidor');
    socket.emit('joinGame', 'Jogador');
});

socket.on('joined', (data) => {
    gameState.playerId = data.playerId;
    
    if (data.waitingForPlayers) {
        playerStatus.innerHTML = '<p>Aguardando mais um jogador...</p>';
    }
});

socket.on('playerJoined', (data) => {
    playerStatus.innerHTML = `<p>Jogadores: ${data.playerCount}/2</p>`;
    if (data.needPlayers === 0) {
        playerStatus.innerHTML = '<p>Iniciando jogo...</p>';
    }
});

socket.on('gameStarted', (data) => {
    gameState.players = data.players;
    gameState.gameStarted = true;
    
    waitingScreen.classList.remove('active');
    gameArea.style.display = 'flex';
    
    startTimer();
    
    // Mensagem inicial
    addMessage({
        playerId: 'system',
        playerName: 'Sistema',
        text: '🎮 Jogo iniciado! Você tem 15 segundos para descobrir quem é o Cabueta. Comece a conversa!',
        timestamp: new Date().toLocaleTimeString()
    });
});

socket.on('newMessage', (message) => {
    addMessage(message);
});

socket.on('timeUp', () => {
    showGuessArea();
});

socket.on('gameResult', (result) => {
    clearInterval(timerInterval);
    gameState.gameEnded = true;
    
    gameArea.style.display = 'none';
    resultScreen.classList.add('active');
    
    if (result.correct) {
        resultScreen.className = 'result-screen active correct';
        resultContent.innerHTML = `
            <h2>🎉 Acertou!</h2>
            <p><strong>${result.guesserName}</strong> descobriu corretamente que <strong>${result.cabuetaName}</strong> era o Cabueta!</p>
            <p>Parabéns pela dedução! 🕵️</p>
        `;
    } else {
        resultScreen.className = 'result-screen active incorrect';
        resultContent.innerHTML = `
            <h2>😅 Errou!</h2>
            <p><strong>${result.guesserName}</strong> escolheu <strong>${result.guessedName}</strong>, mas o Cabueta era <strong>${result.cabuetaName}</strong>!</p>
            <p>O bot conseguiu enganar vocês desta vez! 🤖</p>
        `;
    }
});

socket.on('gameReset', () => {
    // Reset do estado
    gameState = {
        playerId: null,
        players: [],
        gameStarted: false,
        gameEnded: false,
        timeLeft: 15
    };
    
    clearInterval(timerInterval);
    
    // Reset da UI
    messages.innerHTML = '';
    messageInput.value = '';
    messageInput.disabled = false;
    sendBtn.disabled = false;
    guessArea.style.display = 'none';
    
    // Mostrar tela de espera
    gameArea.style.display = 'none';
    resultScreen.classList.remove('active');
    waitingScreen.classList.add('active');
    
    playerStatus.innerHTML = '<p>Reconectando...</p>';
    
    // Rejoin
    setTimeout(() => {
        socket.emit('joinGame', 'Jogador');
    }, 1000);
});

socket.on('gameFull', () => {
    playerStatus.innerHTML = '<p style="color: red;">Jogo lotado! Tente novamente mais tarde.</p>';
});

socket.on('disconnect', () => {
    playerStatus.innerHTML = '<p style="color: red;">Conexão perdida. Tentando reconectar...</p>';
});
