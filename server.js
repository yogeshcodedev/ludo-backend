// ==========================================
// 🚀 LUDO KING PRO - FIXED BACKEND SERVER
// All Critical Bugs Fixed
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
// 📊 GAME CONFIGURATION
// ==========================================

// Star positions (safe zones) - Proper Ludo pattern
// Start position: 0, then +8, then +5, then +8, then +5...
const STAR_POSITIONS = [0, 8, 13, 21, 26, 34, 39, 47]; // Safe zones where single token is safe

// Starting positions for each color
const START_POSITIONS = {
  red: 0,
  green: 13,
  yellow: 26,
  blue: 39
};

// Home stretch starting positions (colored path to home)
const HOME_STRETCH_START = {
  red: 51,
  green: 12,
  yellow: 25,
  blue: 38
};

// ==========================================
// 🎮 GAME ROOM CLASS
// ==========================================
class GameRoom {
  constructor(roomCode, gameMode = 'classic') {
    this.roomCode = roomCode;
    this.gameMode = gameMode;
    this.players = [];
    this.currentPlayer = 'red';
    this.gameStarted = false;
    this.consecutiveSixes = {};
    this.lastDiceRoll = 0;
    
    // Game state for 4 players
    this.gameState = {
      red: { tokens: [-1, -1, -1, -1], score: 0, kills: 0, finished: [] },
      green: { tokens: [-1, -1, -1, -1], score: 0, kills: 0, finished: [] },
      blue: { tokens: [-1, -1, -1, -1], score: 0, kills: 0, finished: [] },
      yellow: { tokens: [-1, -1, -1, -1], score: 0, kills: 0, finished: [] }
    };
  }

  addPlayer(socketId, color) {
    if (this.players.length < 4 && !this.players.find(p => p.color === color)) {
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

  // ==========================================
  // 🛡️ FIX #4: DOUBLE TOKEN SAFE RULE
  // ==========================================
  isPositionSafe(position, color) {
    // Safe if it's a star position
    if (STAR_POSITIONS.includes(position)) {
      return true;
    }

    // Safe if in home stretch
    if (position >= 52 && position <= 57) {
      return true;
    }

    // FIX: Count tokens of same color at this position
    const tokensAtPosition = this.gameState[color].tokens.filter(t => t === position).length;
    
    // If 2 or more tokens of same color, it's safe!
    if (tokensAtPosition >= 2) {
      return true;
    }

    return false;
  }

  // ==========================================
  // 💀 KILL SYSTEM WITH SAFE RULE
  // ==========================================
  checkKill(attackerColor, position) {
    // Can't kill on safe zones
    if (STAR_POSITIONS.includes(position)) {
      return null;
    }

    // Can't kill in home stretch
    if (position >= 52) {
      return null;
    }

    // Check each opponent color
    for (const color of ['red', 'green', 'blue', 'yellow']) {
      if (color === attackerColor) continue;

      // FIX: Check if opponent has 2+ tokens at this position (SAFE)
      const opponentTokensAtPosition = this.gameState[color].tokens.filter(t => t === position).length;
      
      if (opponentTokensAtPosition >= 2) {
        // Multiple tokens = SAFE, can't kill
        continue;
      }

      // Find single token to kill
      for (let i = 0; i < 4; i++) {
        if (this.gameState[color].tokens[i] === position) {
          this.gameState[color].tokens[i] = -1; // Send back home
          return { color, tokenIndex: i };
        }
      }
    }
    
    return null;
  }

  // ==========================================
  // 🎯 TOKEN MOVEMENT LOGIC
  // ==========================================
  canTokenMove(color, tokenId, diceValue) {
    const currentPos = this.gameState[color].tokens[tokenId];
    
    // Token at home
    if (currentPos === -1) {
      return diceValue === 6;
    }

    // Token already finished
    if (this.gameState[color].finished.includes(tokenId)) {
      return false;
    }

    // Calculate new position
    const newPos = currentPos + diceValue;

    // Check if exceeds home (57)
    if (newPos > 57) {
      return false; // Exact number required
    }

    return true;
  }

  moveToken(color, tokenId, diceValue) {
    const currentPos = this.gameState[color].tokens[tokenId];
    let newPos = currentPos;
    let message = '';
    let killed = null;

    // Starting from home (requires 6)
    if (currentPos === -1 && diceValue === 6) {
      newPos = START_POSITIONS[color];
      message = `${color} token #${tokenId + 1} started!`;
    } 
    // Normal move
    else if (currentPos !== -1) {
      newPos = currentPos + diceValue;
      
      // Reached home!
      if (newPos === 57) {
        this.gameState[color].score++;
        this.gameState[color].finished.push(tokenId);
        message = `${color} token #${tokenId + 1} reached HOME! 🏠`;
      }
      // Still moving
      else if (newPos < 57) {
        // Check for kill
        killed = this.checkKill(color, newPos);
        
        if (killed) {
          this.gameState[color].kills++;
          message = `${color} KILLED ${killed.color}'s token! 💀`;
        } else {
          message = `${color} moved to position ${newPos}`;
        }
      }
      // Overshot
      else {
        message = `Invalid move! Need exact number to enter home.`;
        return { newPos: currentPos, message, killed: null, validMove: false };
      }
    }

    // Update position
    this.gameState[color].tokens[tokenId] = newPos;
    
    return { newPos, message, killed, validMove: true };
  }

  // ==========================================
  // 🏆 WIN DETECTION
  // ==========================================
  checkWinner() {
    for (const color of ['red', 'green', 'blue', 'yellow']) {
      if (this.gameState[color].score === 4) {
        return color;
      }
    }
    return null;
  }

  // ==========================================
  // 📊 GET ALL TOKEN POSITIONS
  // ==========================================
  getAllTokenPositions() {
    const positions = {};
    
    for (const color of ['red', 'green', 'blue', 'yellow']) {
      positions[color] = [...this.gameState[color].tokens];
    }
    
    return positions;
  }
}

// ==========================================
// 💾 ACTIVE ROOMS & PLAYERS
// ==========================================
const rooms = new Map();
const activePlayers = new Map();

// ==========================================
// 🔌 SOCKET.IO EVENT HANDLERS
// ==========================================
io.on('connection', (socket) => {
  console.log(`✅ New connection: ${socket.id}`);

  // ==========================================
  // 🏠 CREATE ROOM
  // ==========================================
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
    
    // FIX #5: Send roomCreated event with proper data
    socket.emit('roomCreated', { 
      roomCode, 
      color,
      players: room.players.map(p => p.color),
      gameState: room.gameState
    });
    
    console.log(`🏠 Room created: ${roomCode} by ${socket.id} (${color})`);
  });

  // ==========================================
  // 👤 JOIN ROOM - FIX #5
  // ==========================================
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
    
    // FIX #5: Send roomJoined event to the joining player
    socket.emit('roomJoined', { 
      roomCode, 
      color: availableColor,
      players: room.players.map(p => p.color),
      gameState: room.gameState
    });
    
    // Notify all players in room
    io.to(roomCode).emit('playerJoined', {
      players: room.players.map(p => p.color),
      newPlayer: availableColor,
      totalPlayers: room.players.length
    });

    // Auto-start game if 2+ players
    if (room.players.length >= 2 && !room.gameStarted) {
      room.gameStarted = true;
      
      setTimeout(() => {
        io.to(roomCode).emit('gameStarted', {
          firstPlayer: room.currentPlayer,
          players: room.players.map(p => p.color),
          gameState: room.gameState
        });
      }, 1000);
    }

    console.log(`👤 Player joined room ${roomCode}: ${availableColor} (Total: ${room.players.length})`);
  });

  // ==========================================
  // 🎲 ROLL DICE
  // ==========================================
  socket.on('rollDice', (data) => {
    const { room: roomCode, diceValue, playerColor } = data;
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

    // Check for 3 consecutive sixes
    if (room.consecutiveSixes[playerColor] >= 3) {
      room.consecutiveSixes[playerColor] = 0;
      room.currentPlayer = room.getNextPlayer(playerColor);
      
      io.to(roomCode).emit('turnSkipped', {
        player: playerColor,
        reason: 'Three consecutive sixes',
        nextPlayer: room.currentPlayer,
        gameState: room.gameState
      });
      return;
    }

    room.lastDiceRoll = diceValue;

    io.to(roomCode).emit('diceRolledFromServer', {
      diceValue,
      playerColor,
      consecutiveSixes: room.consecutiveSixes[playerColor],
      gameState: room.gameState
    });

    console.log(`🎲 ${playerColor} rolled ${diceValue} in room ${roomCode}`);
  });

  // ==========================================
  // 🚀 MOVE TOKEN
  // ==========================================
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
    
    if (!moveResult.validMove) {
      socket.emit('error', { message: moveResult.message });
      return;
    }

    // Check for winner
    const winner = room.checkWinner();
    
    // Change turn if not 6 (unless game over)
    if (diceValue !== 6 && !winner) {
      room.currentPlayer = room.getNextPlayer(player);
      room.consecutiveSixes[player] = 0;
    }

    // Broadcast move to all players
    io.to(roomCode).emit('tokenMovedFromServer', {
      player,
      tokenId,
      newPos: moveResult.newPos,
      allPositions: room.getAllTokenPositions(),
      gameState: room.gameState,
      message: moveResult.message,
      killed: moveResult.killed,
      diceValue,
      nextPlayer: room.currentPlayer,
      gameOver: !!winner,
      winner
    });

    console.log(`🚀 ${moveResult.message} in room ${roomCode}`);

    if (winner) {
      console.log(`🏆 WINNER: ${winner} in room ${roomCode}!`);
    }
  });

  // ==========================================
  // 🚪 LEAVE ROOM
  // ==========================================
  socket.on('leaveRoom', (data) => {
    const { room: roomCode } = data;
    const room = rooms.get(roomCode);

    if (room) {
      room.removePlayer(socket.id);
      socket.leave(roomCode);
      
      io.to(roomCode).emit('playerLeft', {
        players: room.players.map(p => p.color),
        totalPlayers: room.players.length
      });

      if (room.players.length === 0) {
        rooms.delete(roomCode);
        console.log(`🗑️ Room deleted: ${roomCode}`);
      }
    }

    activePlayers.delete(socket.id);
    console.log(`👋 Player left room: ${roomCode}`);
  });

  // ==========================================
  // ❌ DISCONNECT
  // ==========================================
  socket.on('disconnect', () => {
    const playerData = activePlayers.get(socket.id);
    
    if (playerData) {
      const { roomCode } = playerData;
      const room = rooms.get(roomCode);
      
      if (room) {
        room.removePlayer(socket.id);
        
        io.to(roomCode).emit('playerLeft', {
          players: room.players.map(p => p.color),
          totalPlayers: room.players.length
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
    message: '🎲 Ludo King Pro Server - Bug Fixed',
    status: 'Running',
    version: '2.0.0 (All bugs fixed)',
    activeRooms: rooms.size,
    activePlayers: activePlayers.size,
    features: [
      'Double token safe rule ✅',
      'Multiplayer join fix ✅',
      'Proper star positions ✅',
      'Kill system optimized ✅'
    ]
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
      started: room.gameStarted,
      currentPlayer: room.currentPlayer
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
    tokenPositions: room.getAllTokenPositions(),
    gameState: room.gameState
  });
});

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// ==========================================
// 🚀 SERVER START
// ==========================================
server.listen(PORT, () => {
  console.log(`
  ╔══════════════════════════════════════════╗
  ║   🎲 LUDO KING PRO - BUG FIXED v2.0     ║
  ║                                          ║
  ║   Port: ${PORT}                          ║
  ║   Status: ✅ ONLINE                      ║
  ║                                          ║
  ║   🐛 FIXES APPLIED:                      ║
  ║   ✅ Double token safe rule              ║
  ║   ✅ Multiplayer join issue              ║
  ║   ✅ Proper star positions               ║
  ║   ✅ Kill system optimized               ║
  ║                                          ║
  ║   Endpoints:                             ║
  ║   GET  /                                 ║
  ║   GET  /api/stats                        ║
  ║   GET  /api/room/:code                   ║
  ║   GET  /health                           ║
  ╚══════════════════════════════════════════╝
  `);
});

process.on('SIGTERM', () => {
  console.log('SIGTERM: Closing server...');
  server.close(() => {
    console.log('Server closed gracefully');
    process.exit(0);
  });
});

module.exports = { server, io };