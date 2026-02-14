const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

// Express App aur HTTP Server setup
const app = express();
app.use(cors());
const server = http.createServer(app);

// Socket.io setup (CORS allow karna zaroori hai mobile app ke liye)
const io = new Server(server, {
  cors: {
    origin: "*", 
    methods: ["GET", "POST"]
  }
});

// Jab bhi koi naya player (app) server se judega
io.on('connection', (socket) => {
  console.log('🟢 Naya Player Connect Hua! Socket ID:', socket.id);

  // 1. DICE ROLL LOGIC: Jab koi player apne phone par dice roll karega
  socket.on('rollDice', (data) => {
    console.log(`Player ${socket.id} ne Dice Roll kiya. Number: ${data.diceValue}`);
    
    // io.emit() sabhi connected players ko yeh data bhej dega (jisne roll kiya usko bhi)
    io.emit('diceRolledFromServer', {
      diceValue: data.diceValue,
      playerColor: data.playerColor
    });
  });

  // 2. MOVE TOKEN LOGIC: Jab koi goti chalega
  socket.on('moveToken', (data) => {
    console.log(`Player ${data.playerColor} ne goti chali position ${data.newPosition} par`);
    
    // Sabko batao ki goti kahan pahaunchi
    io.emit('tokenMovedFromServer', data);
  });

  // Jab player app band kar de ya disconnect ho jaye
  socket.on('disconnect', () => {
    console.log('🔴 Player Disconnect Ho Gaya:', socket.id);
  });
});

// Server ko port 3000 par start karna
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Ludo Multiplayer Server http://localhost:${PORT} par chal raha hai`);
});