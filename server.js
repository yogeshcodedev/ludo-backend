// ==========================================
// 🚀 LUDO KING PRO - BACKEND SERVER
// Node.js + Express + Socket.io
// ==========================================

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// ==========================================
// 📊 GAME STATE MANAGEMENT
// ==========================================
const rooms = new Map();
const activePlayers = new Map();

// Room structure
class GameRoom {
  constructor(roomCode, gameMode = 'classic') {
    this.roomCode = roomCode;
    this.gameMode = gameMode;
    this.players = [];
    this.currentPlayer = 'red';
    this.gameStarted = false;
    this.consecutiveSixes = {};
    this.gameState = {
      red: { tokens: [-1, -1, -1, -1], score: 0, kills: 0 },
      green: { tokens: [-1, -1, -1, -1], score: 0, kills: 0 },
      blue: { tokens: [-1, -1, -1, -1], score: 0, kills: 0 },
      yellow: { tokens: [-1, -1, -1, -1], score: 0, kills: 0 }
    };
  }

  addPlayer(socketId, color) {
    if (this.players.length < 4) {
      this.players.push({ socketId, color });
      this.consecutiveSixes[color] = 0;
      return true;
    }
    return false;
  }

  removePlayer(socketId) {
    this.players = this.players.filter(p => p.socketId !== socketId);
  }

  getNextPlayer(current) {
    const order = ['red', 'green', 'yellow', 'blue'];
    const activeColors = this.players.map(p => p.color);
    const currentIndex = order.indexOf(current);
    
    for (let i = 1; i <= 4; i++) {
      const nextColor = order[(currentIndex + i) % 4];
      if (activeColors.includes(nextColor)) {
        return nextColor;
      }
    }
    return current;
  }

  canTokenMove(color, tokenId, diceValue) {
    const currentPos = this.gameState[color].tokens[tokenId];
    
    // Token home mein hai
    if (currentPos === -1) {
      return diceValue === 6;
    }

    // Token finish line ke paas hai
    const newPos = currentPos + diceValue;
    if (newPos > 57) {
      return false; // Exact number chahiye
    }

    return true;
  }

  moveToken(color, tokenId, diceValue) {
    const currentPos = this.gameState[color].tokens[tokenId];
    let newPos = currentPos;
    let message = '';
    let killed = false;

    // Starting position
    if (currentPos === -1 && diceValue === 6) {
      newPos = 0;
      message = `${color} token started!`;
    } 
    // Normal move
    else if (currentPos !== -1) {
      newPos = currentPos + diceValue;
      
      // Check if token reached home
      if (newPos === 57) {
        this.gameState[color].score++;
        message = `${color} token reached home! 🏠`;
      }
      // Check for kills
      else if (newPos < 57) {
        const killedColor = this.checkKill(color, newPos);
        if (killedColor) {
          this.gameState[color].kills++;
          killed = true;
          message = `${color} killed ${killedColor}! 💀`;
        } else {
          message = `${color} moved to position ${newPos}`;
        }
      }
    }

    this.gameState[color].tokens[tokenId] = newPos;
    return { newPos, message, killed };
  }

  checkKill(attackerColor, position) {
    const safeZones = [0, 8, 13, 21, 26, 34, 39, 47]; // Safe positions
    
    if (safeZones.includes(position)) {
      return null;
    }

    for (const color of ['red', 'green', 'blue', 'yellow']) {
      if (color === attackerColor) continue;
      
      for (let i = 0; i < 4; i++) {
        if (this.gameState[color].tokens[i] === position) {
          this.gameState[color].tokens[i] = -1; // Send back home
          return color;
        }
      }
    }
    return null;
  }

  checkWinner() {
    for (const color of ['red', 'green', 'blue', 'yellow']) {
      if (this.gameState[color].score === 4) {
        return color;
      }
    }
    return null;
  }
}

// ==========================================
// 🔌 SOCKET.IO EVENT HANDLERS
// ==========================================
io.on('connection', (socket) => {
  console.log(`✅ New connection: ${socket.id}`);

  // CREATE ROOM
  socket.on('createRoom', (data) => {
    const { roomCode, gameMode } = data;
    
    if (rooms.has(roomCode)) {
      socket.emit('error', { message: 'Room already exists!' });
      return;
    }

    const room = new GameRoom(roomCode, gameMode);
    const color = 'red'; // First player always red
    
    room.addPlayer(socket.id, color);
    rooms.set(roomCode, room);
    activePlayers.set(socket.id, { roomCode, color });
    
    socket.join(roomCode);
    socket.emit('roomCreated', { roomCode, color });
    
    console.log(`🏠 Room created: ${roomCode} by ${socket.id}`);
  });

  // JOIN ROOM
  socket.on('joinRoom', (roomCode) => {
    const room = rooms.get(roomCode);
    
    if (!room) {
      socket.emit('error', { message: 'Room not found!' });
      return;
    }

    if (room.players.length >= 4) {
      socket.emit('error', { message: 'Room is full!' });
      return;
    }

    const colors = ['red', 'green', 'blue', 'yellow'];
    const takenColors = room.players.map(p => p.color);
    const availableColor = colors.find(c => !takenColors.includes(c));

    if (!availableColor) {
      socket.emit('error', { message: 'No colors available!' });
      return;
    }

    room.addPlayer(socket.id, availableColor);
    activePlayers.set(socket.id, { roomCode, color: availableColor });
    
    socket.join(roomCode);
    socket.emit('roomJoined', { roomCode, color: availableColor });
    
    io.to(roomCode).emit('playerJoined', {
      players: room.players.map(p => p.color),
      newPlayer: availableColor
    });

    // Start game if 2+ players (for testing) or 4 players (for full game)
    if (room.players.length >= 2 && !room.gameStarted) {
      room.gameStarted = true;
      io.to(roomCode).emit('gameStarted', {
        firstPlayer: room.currentPlayer,
        players: room.players.map(p => p.color)
      });
    }

    console.log(`👤 Player joined room ${roomCode}: ${availableColor}`);
  });

  // ROLL DICE
  socket.on('rollDice', (data) => {
    const { room: roomCode, diceValue, playerColor, consecutiveSixes } = data;
    const room = rooms.get(roomCode);

    if (!room) {
      socket.emit('error', { message: 'Room not found!' });
      return;
    }

    if (room.currentPlayer !== playerColor) {
      socket.emit('error', { message: 'Not your turn!' });
      return;
    }

    // Update consecutive sixes
    if (diceValue === 6) {
      room.consecutiveSixes[playerColor]++;
    } else {
      room.consecutiveSixes[playerColor] = 0;
    }

    // Check for 3 consecutive sixes (skip turn)
    if (room.consecutiveSixes[playerColor] >= 3) {
      room.consecutiveSixes[playerColor] = 0;
      room.currentPlayer = room.getNextPlayer(playerColor);
      
      io.to(roomCode).emit('turnSkipped', {
        player: playerColor,
        reason: 'Three consecutive sixes',
        nextPlayer: room.currentPlayer
      });
      return;
    }

    io.to(roomCode).emit('diceRolledFromServer', {
      diceValue,
      playerColor,
      consecutiveSixes: room.consecutiveSixes[playerColor]
    });

    console.log(`🎲 ${playerColor} rolled ${diceValue} in room ${roomCode}`);
  });

  // MOVE TOKEN
  socket.on('moveToken', (data) => {
    const { room: roomCode, player, tokenId, diceValue } = data;
    const room = rooms.get(roomCode);

    if (!room) {
      socket.emit('error', { message: 'Room not found!' });
      return;
    }

    if (room.currentPlayer !== player) {
      socket.emit('error', { message: 'Not your turn!' });
      return;
    }

    if (!room.canTokenMove(player, tokenId, diceValue)) {
      socket.emit('error', { message: 'Invalid move!' });
      return;
    }

    const moveResult = room.moveToken(player, tokenId, diceValue);
    
    // Check for winner
    const winner = room.checkWinner();
    
    // Change turn if not 6 (unless game is over)
    if (diceValue !== 6 && !winner) {
      room.currentPlayer = room.getNextPlayer(player);
    }

    io.to(roomCode).emit('tokenMovedFromServer', {
      player,
      tokenId,
      newPos: moveResult.newPos,
      gameState: room.gameState,
      message: moveResult.message,
      diceValue,
      nextPlayer: room.currentPlayer,
      gameOver: !!winner,
      winner
    });

    console.log(`🚀 Token moved in room ${roomCode}: ${moveResult.message}`);

    if (winner) {
      console.log(`🏆 Game Over! ${winner} wins in room ${roomCode}`);
    }
  });

  // LEAVE ROOM
  socket.on('leaveRoom', (data) => {
    const { room: roomCode } = data;
    const room = rooms.get(roomCode);

    if (room) {
      room.removePlayer(socket.id);
      socket.leave(roomCode);
      
      io.to(roomCode).emit('playerLeft', {
        players: room.players.map(p => p.color)
      });

      // Delete room if empty
      if (room.players.length === 0) {
        rooms.delete(roomCode);
        console.log(`🗑️ Room deleted: ${roomCode}`);
      }
    }

    activePlayers.delete(socket.id);
    console.log(`👋 Player left room: ${roomCode}`);
  });

  // DISCONNECT
  socket.on('disconnect', () => {
    const playerData = activePlayers.get(socket.id);
    
    if (playerData) {
      const { roomCode } = playerData;
      const room = rooms.get(roomCode);
      
      if (room) {
        room.removePlayer(socket.id);
        
        io.to(roomCode).emit('playerLeft', {
          players: room.players.map(p => p.color)
        });

        if (room.players.length === 0) {
          rooms.delete(roomCode);
          console.log(`🗑️ Room deleted: ${roomCode}`);
        }
      }
      
      activePlayers.delete(socket.id);
    }
    
    console.log(`❌ Disconnected: ${socket.id}`);
  });
});

// ==========================================
// 🌐 REST API ENDPOINTS
// ==========================================
app.get('/', (req, res) => {
  res.json({
    message: '🎲 Ludo King Pro Server',
    status: 'Running',
    activeRooms: rooms.size,
    activePlayers: activePlayers.size,
    version: '1.0.0'
  });
});

app.get('/api/stats', (req, res) => {
  res.json({
    totalRooms: rooms.size,
    totalPlayers: activePlayers.size,
    roomDetails: Array.from(rooms.values()).map(room => ({
      code: room.roomCode,
      players: room.players.length,
      gameMode: room.gameMode,
      started: room.gameStarted
    }))
  });
});

app.get('/api/room/:code', (req, res) => {
  const room = rooms.get(req.params.code);
  
  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }

  res.json({
    roomCode: room.roomCode,
    gameMode: room.gameMode,
    players: room.players.map(p => p.color),
    currentPlayer: room.currentPlayer,
    gameStarted: room.gameStarted,
    gameState: room.gameState
  });
});

// Health check endpoint for Render
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'healthy' });
});

// ==========================================
// 🚀 SERVER START
// ==========================================
server.listen(PORT, () => {
  console.log(`
  ╔═══════════════════════════════════════╗
  ║   🎲 LUDO KING PRO SERVER RUNNING     ║
  ║                                       ║
  ║   Port: ${PORT}                       ║
  ║   Status: ✅ ONLINE                   ║
  ║                                       ║
  ║   Endpoints:                          ║
  ║   GET  /                              ║
  ║   GET  /api/stats                     ║
  ║   GET  /api/room/:code                ║
  ║   GET  /health                        ║
  ╚═══════════════════════════════════════╝
  `);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
    process.exit(0);
  });
}); 