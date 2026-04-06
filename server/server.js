const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json());

const DATA_FILE = path.join(__dirname, 'data.json');

const defaultData = {
  users: [
    { id: '1', username: '紫罗兰', password: '152720', role: 'owner' }
  ],
  rooms: [
    { id: 'lobby', name: '大厅', status: 'idle', users: [], isDefault: true }
  ]
};

function loadData() {
  if (fs.existsSync(DATA_FILE)) {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  }
  saveData(defaultData);
  return defaultData;
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

let data = loadData();

const onlineUsers = new Map();
// 房间计时器管�?
const roomTimers = new Map();
// 断开连接用户管理（用于延迟处理）
const disconnectedUsers = new Map();
// 断开连接延迟时间（毫秒）
const DISCONNECT_DELAY = 3000;

// 初始化用户在线状�?
function initUserStatus() {
  data.users.forEach(user => {
    user.online = false;
  });
  saveData(data);
}

// 初始化房间计时器
function initRoomTimers() {
  data.rooms.forEach(room => {
    if (!room.isDefault && (room.status === 'matching' || room.status === 'gaming')) {
      startRoomTimer(room.id);
    }
  });
}

// 开始房间计时器
function startRoomTimer(roomId) {
  // 清除已有的计时器
  if (roomTimers.has(roomId)) {
    clearInterval(roomTimers.get(roomId));
  }
  
  // 初始化计时数
  const room = data.rooms.find(r => r.id === roomId);
  if (room) {
    if (!room.timer) {
      room.timer = 0;
    }
    
    console.log(`计时器启动 房间ID: ${roomId} 状态: ${room.status}`);
    
    // 每秒更新一次计时
    const timer = setInterval(() => {
      const room = data.rooms.find(r => r.id === roomId);
      if (room) {
        room.timer++;
        
        // 保存数据并广播更新
        saveData(data);
        broadcastRooms();
        
        // 匹配中状态的处理
        if (room.status === 'matching') {
          // 每满1分钟，推送voiceReminder事件
          if (room.timer % 60 === 0 && room.timer > 0) {
            console.log(`推送 voiceReminder 房间ID: ${roomId} 已运行: ${room.timer}秒`);
            io.to(roomId).emit('voiceReminder');
          }
          
          // 累计满5分钟未变更状态，自动改为空闲
        if (room.timer >= 300) {
            console.log(`房间状态变化 房间ID: ${roomId} 旧状态: ${room.status} 新状态: idle`);
            room.status = 'idle';
            // 将房间里所有成员的状态也改为 idle
            room.users.forEach(u => {
              u.status = 'idle';
            });
            console.log('超时后房间成员状态:', JSON.stringify(room.users));
        room.timer = 0;
        clearInterval(roomTimers.get(roomId));
        roomTimers.delete(roomId);
        
        saveData(data);
        broadcastRooms();
        io.to(roomId).emit('roomUsersUpdated', room.users);
          }
        } 
        // 游戏中状态的处理
        else if (room.status === 'gaming') {
          // 累计满15分钟未变更状态，自动改为空闲
        if (room.timer >= 900) {
            console.log(`房间状态变化 房间ID: ${roomId} 旧状态: ${room.status} 新状态: idle`);
            room.status = 'idle';
            // 将房间里所有成员的状态也改为 idle
            room.users.forEach(u => {
              u.status = 'idle';
            });
            console.log('超时后房间成员状态:', JSON.stringify(room.users));
        room.timer = 0;
        clearInterval(roomTimers.get(roomId));
        roomTimers.delete(roomId);
        
        saveData(data);
        broadcastRooms();
        io.to(roomId).emit('roomUsersUpdated', room.users);
          }
        }
      }
    }, 1000);
    
    roomTimers.set(roomId, timer);
  }
}

// 停止房间计时器
function stopRoomTimer(roomId) {
  if (roomTimers.has(roomId)) {
    clearInterval(roomTimers.get(roomId));
    roomTimers.delete(roomId);
  }
  
  const room = data.rooms.find(r => r.id === roomId);
  if (room) {
    room.timer = 0;
  }
}

// 将房间内所有成员踢回大厅
function kickUsersToLobby(roomId) {
  const room = data.rooms.find(r => r.id === roomId);
  if (!room || room.isDefault) return;
  
  const lobbyRoom = data.rooms.find(r => r.isDefault);
  if (!lobbyRoom) return;
  
  const roomUsers = [...room.users]; // 保存房间内的用户
  
  // 将所有用户移到大
  roomUsers.forEach(user => {
    if (!user || !user.id) return;
    
    // 检查用户是否已经在大厅
    const userInLobby = lobbyRoom.users.find(u => u.id === user.id);
    if (!userInLobby) {
      lobbyRoom.users.push(user);
    }
    
    // 更新在线用户的当前房间
    onlineUsers.forEach((onlineUser, socketId) => {
      if (onlineUser.id === user.id) {
        onlineUser.currentRoom = lobbyRoom.id;
        // 广播用户移动消息
        io.emit('user_moved', {
          userId: user.id,
          username: user.username,
          fromRoom: roomId,
          toRoom: lobbyRoom.id
        });
      }
    });
  });
  
  // 清空房间
  room.users = [];
  
  // 广播大厅用户更新
  io.to(lobbyRoom.id).emit('roomUsersUpdated', lobbyRoom.users);
  // 广播原房间用户更新（为空）
  io.to(roomId).emit('roomUsersUpdated', room.users);
}

// 初始化用户状�?
initUserStatus();
// 初始化房间计时器
initRoomTimers();

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const user = data.users.find(u => u.username === username && u.password === password);
  
  if (user) {
    // 设置用户在线状�?
    user.online = true;
    saveData(data);
    
    // 广播用户状态更�?
    io.emit('user_status_updated', {
      id: user.id,
      username: user.username,
      role: user.role,
      online: true
    });
    
    res.json({ success: true, user: { id: user.id, username: user.username, role: user.role, online: true } });
  } else {
    res.json({ success: false, message: '用户名或密码错误' });
  }
});

app.get('/api/rooms', (req, res) => {
  const roomsWithUserCount = data.rooms.map(room => ({
    ...room,
    userCount: room.users.length,
    timer: room.timer || 0
  }));
  
  res.json(roomsWithUserCount);
});

app.get('/api/rooms/:id/users', (req, res) => {
  const { id } = req.params;
  const room = data.rooms.find(room => room.id === id);
  
  if (!room) {
    return res.json({ success: false, message: '房间不存在' });
  }
  
  res.json(room.users);
});

app.post('/api/rooms/:id/kick', (req, res) => {
  const { id } = req.params;
  const { userId, kickedBy } = req.body;
  
  // 查找房间
  const room = data.rooms.find(room => room.id === id);
  if (!room) {
    return res.json({ success: false, message: '房间不存在' });
  }
  
  // 查找操作用户并检查权限
  const operator = data.users.find(u => u.id === kickedBy);
  if (!operator) {
    return res.json({ success: false, message: '操作用户不存在' });
  }
  
  if (operator.role !== 'owner' && operator.role !== 'admin') {
    return res.json({ success: false, message: '权限不足' });
  }
  
  // 查找被踢用户
  const userToKick = data.users.find(u => u.id === userId);
  if (!userToKick) {
    return res.json({ success: false, message: '被踢用户不存在' });
  }
  
  // 不允许踢房主
  if (userToKick.role === 'owner') {
    return res.json({ success: false, message: '无法踢出房主' });
  }
  
  // 从房间中移除用户
  room.users = room.users.filter(u => u.id !== userId);
  saveData(data);
  
  // 找到被踢用户的 socket 并通知
  let kickedSocketId = null;
  onlineUsers.forEach((onlineUser, socketId) => {
    if (onlineUser.id === userId) {
      kickedSocketId = socketId;
    }
  });
  
  if (kickedSocketId) {
    io.to(kickedSocketId).emit('kicked', {
      message: '你被踢出房间',
      roomId: room.id,
      roomName: room.name
    });
  }
  
  // 广播房间成员更新
  io.to(room.id).emit('roomUsersUpdated', room.users);
  
  // 广播房间列表更新
  broadcastRooms();
  
  res.json({ success: true, message: '用户已成功踢出' });
});

app.post('/api/rooms', (req, res) => {
  const { name, createdBy } = req.body;
  
  // 查找用户并检查权限
  const user = data.users.find(u => u.id === createdBy);
  if (!user) {
    return res.json({ success: false, message: '用户不存在' });
  }
  
  if (user.role !== 'owner' && user.role !== 'admin') {
    return res.json({ success: false, message: '权限不足' });
  }
  
  const newRoom = {
    id: Date.now().toString(),
    name,
    status: 'idle',
    users: [],
    createdBy,
    isDefault: false
  };
  data.rooms.push(newRoom);
  saveData(data);
  
  io.emit('roomsUpdated', data.rooms.map(room => ({
    ...room,
    userCount: room.users.length
  })));
  
  res.json({ success: true, room: newRoom });
});

app.post('/api/users', (req, res) => {
  const { username, createdBy } = req.body;
  
  // 查找用户并检查权限
  const user = data.users.find(u => u.id === createdBy);
  if (!user) {
    return res.json({ success: false, message: '用户不存在' });
  }
  
  if (user.role !== 'owner' && user.role !== 'admin') {
    return res.json({ success: false, message: '权限不足' });
  }
  
  // 检查用户名是否已存在
  const existingUser = data.users.find(u => u.username === username);
  console.log('添加用户 - 用户名:', username, '已存在用户:', existingUser ? existingUser.username : '无');
  console.log('当前用户列表:', data.users.map(u => u.username));
  
  if (existingUser) {
    return res.json({ success: false, message: '用户名已存在' });
  }
  
  const newUser = {
    id: Date.now().toString(),
    username,
    password: '123456',
    role: 'user',
    createdBy
  };
  data.users.push(newUser);
  saveData(data);
  
  // 广播用户添加成功消息
  
  io.emit('user_added', { success: true, user: { id: newUser.id, username: newUser.username, role: newUser.role } });
  
  res.json({ success: true, user: { id: newUser.id, username: newUser.username, role: newUser.role } });
});

app.get('/api/users', (req, res) => {
  const users = data.users.map(user => ({
    id: user.id,
    username: user.username,
    role: user.role,
    online: user.online || false
  }));
  res.json(users);
});

app.put('/api/users/:id/role', (req, res) => {
  const { id } = req.params;
  const { role, userId } = req.body;
  
  // 查找用户并检查权限
  const user = data.users.find(u => u.id === userId);
  if (!user) {
    return res.json({ success: false, message: '用户不存在' });
  }
  
  if (user.role !== 'owner') {
    return res.json({ success: false, message: '权限不足' });
  }
  
  // 不允许修改房主角�?
  if (id === '1') {
    return res.json({ success: false, message: '无法修改房主角色' });
  }
  
  const userIndex = data.users.findIndex(user => user.id === id);
  if (userIndex === -1) {
    return res.json({ success: false, message: '用户不存在' });
  }
  
  data.users[userIndex].role = role;
  saveData(data);
  
  // 广播用户角色更新消息
  io.emit('user_updated', { success: true, user: data.users[userIndex] });
  
  res.json({ success: true, message: '角色设置成功' });
});

app.delete('/api/users/:id', (req, res) => {
  const { id } = req.params;
  const { userId } = req.body;
  
  // 查找用户并检查权限
  const user = data.users.find(u => u.id === userId);
  if (!user) {
    return res.json({ success: false, message: '用户不存在' });
  }
  
  if (user.role !== 'owner' && user.role !== 'admin') {
    return res.json({ success: false, message: '权限不足' });
  }
  
  // 不允许删除房�?
  if (id === '1') {
    return res.json({ success: false, message: '无法删除房主' });
  }
  
  const userIndex = data.users.findIndex(user => user.id === id);
  if (userIndex === -1) {
    return res.json({ success: false, message: '用户不存在' });
  }
  
  const deletedUser = data.users[userIndex];
  console.log('删除用户 - 用户名:', deletedUser.username, 'ID:', deletedUser.id);
  data.users.splice(userIndex, 1);
  saveData(data);
  console.log('删除后用户列表:', data.users.map(u => u.username));
  
  // 广播用户删除消息
  io.emit('user_deleted', { success: true, userId: id, username: deletedUser.username });
  
  res.json({ success: true, message: '用户删除成功' });
});

app.delete('/api/rooms/:id', (req, res) => {
  const { id } = req.params;
  const { userId } = req.body;
  
  try {
    // 查找用户并检查权限
    const user = data.users.find(u => u.id === userId);
    if (!user) {
      return res.json({ success: false, message: '用户不存在' });
    }
    
    if (user.role !== 'owner' && user.role !== 'admin') {
      return res.json({ success: false, message: '权限不足' });
    }
    
    // 不允许删除默认大�?
    if (id === 'lobby') {
      
      return res.json({ success: false, message: '无法删除默认大厅' });
    }
    
    const roomIndex = data.rooms.findIndex(room => room.id === id);
    if (roomIndex === -1) {
      
      return res.json({ success: false, message: '房间不存在' });
    }
    
    const deletedRoom = data.rooms[roomIndex];
    
    
    const roomUsers = [...deletedRoom.users]; // 保存房间内的用户
    
    
    // 将房间内的所有用户移到大�?
    const lobbyRoom = data.rooms.find(room => room.isDefault);
    if (lobbyRoom) {
      
      roomUsers.forEach(user => {
        
        if (!user || !user.id) {
          
          return;
        }
        // 检查用户是否已经在大厅�?
        const userInLobby = lobbyRoom.users.find(u => u.id === user.id);
        if (!userInLobby) {
          
          lobbyRoom.users.push(user);
        } else {
          
        }
        
        // 更新在线用户的当前房�?
        onlineUsers.forEach((onlineUser, socketId) => {
          if (onlineUser.id === user.id) {
            
            onlineUser.currentRoom = lobbyRoom.id;
            // 广播用户移动消息
            io.emit('user_moved', {
              userId: user.id,
              username: user.username,
              fromRoom: id,
              toRoom: lobbyRoom.id
            });
          }
        });
      });
    }
    
    // 先保存用户移动后的状�?
    
    saveData(data);
    
    
    // 然后删除房间
    
    data.rooms.splice(roomIndex, 1);
    
    
    // 保存删除房间后的状�?
    
    saveData(data);
    
    
    // 广播房间删除消息
    
    io.emit('room_deleted', { success: true, roomId: id });
    
    // 广播大厅用户更新
    if (lobbyRoom) {
      
      io.to(lobbyRoom.id).emit('roomUsersUpdated', lobbyRoom.users);
    }
    
    // 广播房间列表更新
    
    broadcastRooms();
    
    
    res.json({ success: true, message: '房间删除成功' });
  } catch (error) {
    console.error('删除房间时发生错�?', error);
    console.error('错误堆栈:', error.stack);
    res.json({ success: false, message: '删除房间失败' });
  }
});

// 修改密码接口
app.post('/api/user/change-password', (req, res) => {
  const { oldPassword, newPassword, userId } = req.body;
  
  try {
    // 查找用户
    const user = data.users.find(u => u.id === userId);
    if (!user) {
      return res.json({ success: false, message: '用户不存在' });
    }
    
    // 验证旧密码
    if (user.password !== oldPassword) {
      return res.json({ success: false, message: '旧密码错误' });
    }
    
    // 更新密码
    user.password = newPassword;
    saveData(data);
    
    res.json({ success: true, message: '密码修改成功' });
  } catch (error) {
    console.error('修改密码时发生错误:', error);
    res.json({ success: false, message: '修改密码失败' });
  }
});

function broadcastRooms() {
  const roomsWithUserCount = data.rooms.map(room => ({
    ...room,
    userCount: room.users.length,
    timer: room.timer || 0
  }));
  io.emit('roomsUpdated', roomsWithUserCount);
}

io.on('connection', (socket) => {
  
  
  socket.on('join', (userData) => {
    
    
    // 检查用户是否在断开连接列表中（可能是刷新页面）
    if (disconnectedUsers.has(userData.id)) {
      
      const userInfo = disconnectedUsers.get(userData.id);
      // 取消定时�?
      clearTimeout(userInfo.timer);
      // 从断开连接列表中移�?
      disconnectedUsers.delete(userData.id);
      
      
      // 检查用户之前所在的房间
      let previousRoom = null;
      let userPreviousStatus = 'idle';
      data.rooms.forEach(room => {
        const userInRoom = room.users.find(u => u.id === userData.id);
        if (userInRoom) {
          previousRoom = room;
          userPreviousStatus = userInRoom.status;
          
          // 更新用户的peerId
          userInRoom.peerId = userData.peerId || '';
        }
      });
      
      // 更新在线用户信息
      onlineUsers.set(socket.id, { ...userData, socketId: socket.id, currentRoom: previousRoom ? previousRoom.id : null });
      
      
      // 如果用户之前在某个房间，加入该房间的socket房间
      if (previousRoom) {
        socket.join(previousRoom.id);
        
        // 广播房间成员更新，确保包含更新后的peerId
        io.to(previousRoom.id).emit('roomUsersUpdated', previousRoom.users);
      }
    } else {
      // 新用户或首次连接
      onlineUsers.set(socket.id, { ...userData, socketId: socket.id, currentRoom: null });
      
    }
    
    // 设置用户在线状�?
    const userInData = data.users.find(u => u.id === userData.id);
    if (userInData) {
      
      userInData.online = true;
      // 记录用户的peerId（如果有�?
      if (userData.peerId) {
        userInData.peerId = userData.peerId;
        
      }
      saveData(data);
      
      
      // 广播用户状态更�?
      
      io.emit('user_status_updated', {
        id: userData.id,
        username: userData.username,
        role: userData.role,
        online: true,
        peerId: userData.peerId
      });
      
    } else {
      
    }
    
    broadcastRooms();
    
  });
  
  socket.on('enterRoom', ({ roomId, user }) => {
    
    
    const room = data.rooms.find(r => r.id === roomId);
    if (!room) {
      
      return;
    }
    
    const currentUser = onlineUsers.get(socket.id);
    
    // 检查用户是否已经在目标房间�?
    const userInTargetRoom = room.users.find(u => u.id === user.id);
    
    if (userInTargetRoom) {
      // 用户已经在目标房间中，只更新peerId
      
      userInTargetRoom.peerId = user.peerId || '';
    } else {
      // 记录用户之前所在的房间
      let previousRoomId = null;
      data.rooms.forEach(r => {
        if (r.users.find(u => u.id === user.id)) {
          previousRoomId = r.id;
        }
      });
      
      
      
      // 先从所有房间中移除该用户（确保不会同时出现在多个房间）
      data.rooms.forEach(r => {
        const userIndex = r.users.findIndex(u => u.id === user.id);
        if (userIndex !== -1) {
          
          r.users.splice(userIndex, 1);
          if (r.users.length === 0 && !r.isDefault) {
            r.status = 'idle';
          }
          
          // 通知原房间内的其他用�?
          io.to(r.id).emit('roomUsersUpdated', r.users);
        }
      });
      
      // 将用户添加到新房�?
      // 新用户的初始状态应该等于房间的当前状�?
      // 只有房间当前是空闲时，新用户才设为空�?
      const initialStatus = room.status !== 'idle' ? room.status : (user.status || 'idle');
      
      // 确保用户对象包含status和peerId属�?
      const userWithStatus = { 
        ...user, 
        status: initialStatus,
        peerId: user.peerId || ''
      };
      
      
      room.users.push(userWithStatus);
      
    }
    
    if (currentUser) {
      currentUser.currentRoom = roomId;
      // 更新在线用户的peerId
      currentUser.peerId = user.peerId || '';
    }
    socket.join(roomId);
    
    // 更新所有房间中该用户的peerId
    data.rooms.forEach(r => {
      const userInRoom = r.users.find(u => u.id === user.id);
      if (userInRoom) {
        userInRoom.peerId = user.peerId || '';
      }
    });
    
    // 更新用户数据中的peerId
    const userInData = data.users.find(u => u.id === user.id);
    if (userInData) {
      userInData.peerId = user.peerId || '';
    }
    
    saveData(data);
    broadcastRooms();
    
    // 广播更新后的成员列表给房间内所有人，确保包含peerId
    io.to(roomId).emit('roomUsersUpdated', room.users);
  });
  
  socket.on('leaveRoom', ({ roomId, user }) => {
    
    
    
    const room = data.rooms.find(r => r.id === roomId);
    if (!room) {
      
      return;
    }
    
    
    
    
    room.users = room.users.filter(u => u.id !== user.id);
    
    
    
    
    if (room.users.length === 0 && !room.isDefault) {
      room.status = 'idle';
      
    } else if (room.users.length > 0 && !room.isDefault) {
      // 房间状态已经由用户通过 changeRoomStatus 设置
      // 保持当前状态不�?
      
    }
    
    const currentUser = onlineUsers.get(socket.id);
    if (currentUser) {
      currentUser.currentRoom = null;
      
    }
    
    socket.leave(roomId);
    
    
    saveData(data);
    broadcastRooms();
    io.to(roomId).emit('roomUsersUpdated', room.users);
    
    
    // 广播用户离开消息
    io.emit('user_left', {
      userId: user.id,
      username: user.username,
      roomId: roomId
    });
    
  });
  
  socket.on('changeRoomStatus', ({ roomId, status, user }) => {
    
    const room = data.rooms.find(r => r.id === roomId);
    if (!room) {
      
      return;
    }
    
    const oldStatus = room.status;
    room.status = status;
    
    console.log(`房间状态变化 房间ID: ${roomId} 旧状态: ${oldStatus} 新状态: ${status}`);
    
    // 当任意用户点击状态按钮时，更新房间内所有在线用户的状态
    room.users.forEach(userInRoom => {
      userInRoom.status = status;
      
    });
    
    // 管理房间计时器
    if (!room.isDefault) {
      if (status === 'matching' || status === 'gaming') {
        // 开始或重置计时器
        room.timer = 0;
        
        startRoomTimer(roomId);
      } else {
        // 停止计时器
        
        stopRoomTimer(roomId);
        room.timer = 0;
      }
    }
    
    saveData(data);
    
    
    broadcastRooms();
    
    // 通知房间内的其他用户
    io.to(roomId).emit('roomUsersUpdated', room.users);
    
  });
  
  socket.on('send_message', (message) => {
    
    // 广播消息到房间内的所有用�?
    io.to(message.roomId).emit('new_message', message);
  });

  socket.on('update-peer-id', ({ userId, peerId }) => {
    
    // 更新用户数据中的peerId
    const userInData = data.users.find(u => u.id === userId);
    if (userInData) {
      userInData.peerId = peerId;
      saveData(data);
    }
    // 同时更新在线用户中的peerId
    onlineUsers.forEach((onlineUser, socketId) => {
      if (onlineUser.id === userId) {
        onlineUser.peerId = peerId;
      }
    });
    // 更新所有房间中该用户的peerId
    data.rooms.forEach(room => {
      const userInRoom = room.users.find(u => u.id === userId);
      if (userInRoom) {
        userInRoom.peerId = peerId;
      }
    });
    saveData(data);
    // 广播房间成员更新，确保包含peerId
    broadcastRooms();
  });

  socket.on('syncStart', ({ roomId }) => {
    // 向当前房间的所有成员广播同步开始事件
    if (roomId) {
      io.to(roomId).emit('syncStart');
    } else {
      // 如果没有指定房间，向所有连接的用户广播
      io.emit('syncStart');
    }
  });

  socket.on('syncEnd', ({ roomId }) => {
    // 向当前房间的所有成员广播同步结束事件
    console.log('收到 syncEnd 事件');
    console.log('syncEnd 广播');
    if (roomId) {
      io.to(roomId).emit('syncEnd');
    } else {
      // 如果没有指定房间，向所有连接的用户广播
      io.emit('syncEnd');
    }
  });

  socket.on('disconnect', () => {
    
    const user = onlineUsers.get(socket.id);
    if (user) {
      
      
      // 检查用户是否在断开连接列表�?
      if (disconnectedUsers.has(user.id)) {
        
        const userInfo = disconnectedUsers.get(user.id);
        // 取消旧定时器
        clearTimeout(userInfo.timer);
      }
      
      // 启动延迟定时器，3秒后再处理断开连接
      const timer = setTimeout(() => {
        
        
        // 设置用户离线状�?
        const userInData = data.users.find(u => u.id === user.id);
        if (userInData) {
          
          userInData.online = false;
          saveData(data);
          
          // 广播用户状态更�?
          
          io.emit('user_status_updated', {
            id: user.id,
            username: user.username,
            role: user.role,
            online: false
          });
        }
        
        // 从所有房间中移除该用�?
        data.rooms.forEach(room => {
          const userIndex = room.users.findIndex(u => u.id === user.id);
          if (userIndex !== -1) {
            
            room.users.splice(userIndex, 1);
            
            // 重新计算房间状态，只由当前房间内的成员状态决�?
            if (!room.isDefault) {
              if (room.users.length === 0) {
                // 房间成员为空，将房间状态设�?idle，计时器归零
                
                room.status = 'idle';
                room.timer = 0;
                // 停止计时�?
                stopRoomTimer(room.id);
              } else {
                // 房间还有其他成员，按成员状态重新计算（优先级：匹配�?> 游戏�?> 空闲�?
                
                
                // 检查是否有成员处于 matching 状�?
                const hasMatching = room.users.some(u => u.status === 'matching');
                // 检查是否有成员处于 gaming 状�?
                const hasGaming = room.users.some(u => u.status === 'gaming');
                
                const oldStatus = room.status;
                
                if (hasMatching) {
                  // 有成员处�?matching 状态，房间状态设�?matching
                  room.status = 'matching';
                  
                } else if (hasGaming) {
                  // 有成员处�?gaming 状态，房间状态设�?gaming
                  room.status = 'gaming';
                  
                } else {
                  // 所有成员都处于 idle 状态，房间状态设�?idle
                  room.status = 'idle';
                  room.timer = 0;
                  // 停止计时�?
                  stopRoomTimer(room.id);
                  
                }
                
                // 如果状态发生变化，管理计时�?
                if (room.status !== oldStatus) {
                  if (room.status === 'matching' || room.status === 'gaming') {
                    // 开始或重置计时�?
                    room.timer = 0;
                    
                    startRoomTimer(room.id);
                  } else {
                    // 停止计时�?
                    
                    stopRoomTimer(room.id);
                    room.timer = 0;
                  }
                }
              }
            }
            
            // 广播用户离开消息
            io.emit('user_left', {
              userId: user.id,
              username: user.username,
              roomId: room.id
            });
            // 通知房间内的其他用户
            io.to(room.id).emit('roomUsersUpdated', room.users);
          }
        });
        
        // 保存数据
        saveData(data);
        // 广播房间列表更新
        broadcastRooms();
        
        // 从断开连接列表中移�?
        disconnectedUsers.delete(user.id);
        
      }, DISCONNECT_DELAY);
      
      // 将用户添加到断开连接列表
      disconnectedUsers.set(user.id, {
        user,
        timer
      });
      
    }
    onlineUsers.delete(socket.id);
    
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
