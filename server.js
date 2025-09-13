const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.static('public'));

// Cliente Bedrock
const bedrockClient = new BedrockRuntimeClient({ 
  region: process.env.AWS_REGION || 'us-east-1' 
});

// Estado do jogo
let gameState = {
  players: [],
  messages: [],
  gameStarted: false,
  gameEnded: false,
  currentTurn: 0,
  startTime: null,
  cabuetaId: null
};

function resetGame() {
  gameState = {
    players: [],
    messages: [],
    gameStarted: false,
    gameEnded: false,
    currentTurn: 0,
    startTime: null,
    cabuetaId: null
  };
}

function startGame() {
  if (gameState.players.length === 2 && !gameState.gameStarted) {
    // Nomes fixos para os participantes
    const availableNames = ['Alex', 'Bruno', 'Carol'];
    
    // Embaralha os nomes
    const shuffledNames = availableNames.sort(() => Math.random() - 0.5);
    
    // Atribui nomes únicos aos jogadores humanos
    gameState.players[0].displayName = shuffledNames[0];
    gameState.players[1].displayName = shuffledNames[1];
    
    // Adiciona o Cabueta com o terceiro nome
    const cabuetaPlayer = {
      id: 'cabueta-bot',
      displayName: shuffledNames[2],
      isBot: true,
      socket: null
    };
    gameState.players.push(cabuetaPlayer);
    gameState.cabuetaId = cabuetaPlayer.id;

    gameState.gameStarted = true;
    gameState.startTime = Date.now();
    
    // Envia dados personalizados para cada cliente
    gameState.players.forEach(player => {
      if (!player.isBot && player.socket) {
        const personalizedPlayers = gameState.players.map(p => ({
          name: p.id === player.id ? 'Você' : p.displayName,
          id: p.id
        }));
        
        player.socket.emit('gameStarted', {
          players: personalizedPlayers,
          timeLimit: 60000
        });
      }
    });

    // Timer do jogo
    setTimeout(() => {
      if (!gameState.gameEnded) {
        gameState.gameEnded = true;
        io.emit('timeUp');
      }
    }, 60000);
  }
}

async function getCabuetaResponse(message, conversationHistory) {
  try {
    const prompt = `Você está participando de um jogo onde precisa se passar por um humano real em uma conversa de chat. Sua missão é responder de forma natural, casual e humana, evitando soar como um bot.

Contexto da conversa:
${conversationHistory.map(msg => `${msg.playerName}: ${msg.text}`).join('\n')}

Última mensagem: ${message}

Responda de forma breve (máximo 2 frases), natural e humana. Seja conversacional, use gírias ocasionalmente, e demonstre emoções sutis. Evite ser muito formal ou robótico.`;

    const command = new InvokeModelCommand({
      modelId: 'anthropic.claude-3-haiku-20240307-v1:0',
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 100,
        messages: [{
          role: 'user',
          content: prompt
        }]
      })
    });

    const response = await bedrockClient.send(command);
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));
    
    return responseBody.content[0].text.trim();
  } catch (error) {
    console.error('Erro ao chamar Bedrock:', error);
    // Fallback para respostas simples em caso de erro
    const fallbacks = [
      "Interessante...",
      "Concordo!",
      "Hmm, faz sentido.",
      "Verdade!",
      "Boa pergunta!"
    ];
    return fallbacks[Math.floor(Math.random() * fallbacks.length)];
  }
}

io.on('connection', (socket) => {
  console.log('Usuário conectado:', socket.id);

  socket.on('joinGame', (playerName) => {
    if (gameState.players.length < 2 && !gameState.gameStarted) {
      const player = {
        id: socket.id,
        name: `Jogador ${gameState.players.length + 1}`, // Nome temporário
        isBot: false,
        socket: socket
      };
      
      gameState.players.push(player);
      
      socket.emit('joined', {
        playerId: socket.id,
        playerName: player.name,
        waitingForPlayers: gameState.players.length < 2
      });

      io.emit('playerJoined', {
        playerCount: gameState.players.length,
        needPlayers: 2 - gameState.players.length
      });

      if (gameState.players.length === 2) {
        setTimeout(startGame, 1000);
      }
    } else {
      socket.emit('gameFull');
    }
  });

  socket.on('sendMessage', async (data) => {
    if (!gameState.gameStarted || gameState.gameEnded) return;

    const sender = gameState.players.find(p => p.id === socket.id);
    const message = {
      id: Date.now(),
      playerId: socket.id,
      text: data.message,
      timestamp: new Date().toLocaleTimeString()
    };

    gameState.messages.push(message);
    
    // Envia mensagem personalizada para cada cliente
    gameState.players.forEach(player => {
      if (!player.isBot && player.socket) {
        const personalizedMessage = {
          ...message,
          playerName: message.playerId === player.id ? 'Você' : sender.displayName
        };
        player.socket.emit('newMessage', personalizedMessage);
      }
    });

    // Resposta do Cabueta após um delay
    setTimeout(async () => {
      if (!gameState.gameEnded) {
        try {
          const cabuetaResponseText = await getCabuetaResponse(data.message, gameState.messages);
          const cabueta = gameState.players.find(p => p.id === 'cabueta-bot');
          
          const cabuetaMessage = {
            id: Date.now(),
            playerId: 'cabueta-bot',
            text: cabuetaResponseText,
            timestamp: new Date().toLocaleTimeString()
          };
          
          gameState.messages.push(cabuetaMessage);
          
          // Envia resposta do Cabueta para cada cliente
          gameState.players.forEach(player => {
            if (!player.isBot && player.socket) {
              const personalizedCabuetaMessage = {
                ...cabuetaMessage,
                playerName: cabueta.displayName
              };
              player.socket.emit('newMessage', personalizedCabuetaMessage);
            }
          });
        } catch (error) {
          console.error('Erro na resposta do Cabueta:', error);
        }
      }
    }, 1500 + Math.random() * 2000); // 1.5-3.5 segundos de delay
  });

  socket.on('makeGuess', (guessedPlayerId) => {
    if (gameState.gameEnded) return;
    
    gameState.gameEnded = true;
    const guesser = gameState.players.find(p => p.id === socket.id);
    const isCorrect = guessedPlayerId === gameState.cabuetaId;
    const cabueta = gameState.players.find(p => p.id === gameState.cabuetaId);
    const guessedPlayer = gameState.players.find(p => p.id === guessedPlayerId);
    
    console.log(`${guesser.displayName} escolheu ${guessedPlayer.displayName}. Cabueta era ${cabueta.displayName}. Correto: ${isCorrect}`);
    
    // Usa io.emit para garantir que todos recebam
    io.emit('gameResult', {
      correct: isCorrect,
      cabuetaId: gameState.cabuetaId,
      cabuetaName: cabueta.displayName,
      guessedId: guessedPlayerId,
      guessedName: guessedPlayer.displayName,
      guesserName: guesser.displayName
    });
  });

  socket.on('restartGame', () => {
    // Salva referência dos players antes do reset
    const currentPlayers = [...gameState.players];
    resetGame();
    
    // Envia reset para os players salvos
    currentPlayers.forEach(player => {
      if (!player.isBot && player.socket) {
        player.socket.emit('gameReset');
      }
    });
  });

  socket.on('disconnect', () => {
    console.log('Usuário desconectado:', socket.id);
    
    if (gameState.players.filter(p => !p.isBot).length < 2 && gameState.gameStarted) {
      // Salva referência dos players antes do reset
      const currentPlayers = [...gameState.players];
      resetGame();
      
      // Envia reset para os players restantes
      currentPlayers.forEach(player => {
        if (!player.isBot && player.socket && player.id !== socket.id) {
          player.socket.emit('gameReset');
        }
      });
    }
    
    // Remove o player desconectado APÓS enviar os eventos
    gameState.players = gameState.players.filter(p => p.id !== socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
  console.log(`Acesse: http://localhost:${PORT}`);
  console.log('Certifique-se de ter as credenciais AWS configuradas!');
});
