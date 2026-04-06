export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    
    // 添加 CORS 头
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };
    
    // 处理预检请求
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }
    
    // 初始化数据库表
    await this.initDatabase(env.DB);
    
    // 处理 API 请求
    const path = url.pathname;
    
    // 用户相关 API
    if (path === '/api/login') {
      return await this.handleLogin(request, env.DB, corsHeaders);
    } else if (path === '/api/users') {
      if (request.method === 'GET') {
        return await this.getUsers(request, env.DB, corsHeaders);
      } else if (request.method === 'POST') {
        return await this.createUser(request, env.DB, corsHeaders);
      }
    } else if (path.startsWith('/api/users/')) {
      const userId = path.split('/')[3];
      if (path.endsWith('/role')) {
        return await this.updateUserRole(request, env.DB, corsHeaders, userId);
      } else if (request.method === 'DELETE') {
        return await this.deleteUser(request, env.DB, corsHeaders, userId);
      }
    }
    
    // 房间相关 API
    else if (path === '/api/rooms') {
      if (request.method === 'GET') {
        return await this.getRooms(request, env.DB, corsHeaders);
      } else if (request.method === 'POST') {
        return await this.createRoom(request, env.DB, corsHeaders);
      }
    } else if (path.startsWith('/api/rooms/')) {
      const roomId = path.split('/')[3];
      if (path.endsWith('/users')) {
        return await this.getRoomUsers(request, env.DB, corsHeaders, roomId);
      } else if (path.endsWith('/kick')) {
        return await this.kickUser(request, env.DB, corsHeaders, roomId);
      } else if (request.method === 'DELETE') {
        return await this.deleteRoom(request, env.DB, corsHeaders, roomId);
      }
    }
    
    // 用户密码修改 API
    else if (path === '/api/user/change-password') {
      return await this.changePassword(request, env.DB, corsHeaders);
    }
    
    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
      },
    });
  },
  
  // 初始化数据库表
  async initDatabase(db) {
    try {
      // 创建用户表
      await db.exec(`
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT UNIQUE NOT NULL,
          password TEXT NOT NULL,
          role TEXT DEFAULT 'user',
          online BOOLEAN DEFAULT false,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);
      
      // 创建房间表
      await db.exec(`
        CREATE TABLE IF NOT EXISTS rooms (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT UNIQUE NOT NULL,
          status TEXT DEFAULT 'idle',
          is_default BOOLEAN DEFAULT false,
          timer INTEGER DEFAULT 0,
          created_by INTEGER,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (created_by) REFERENCES users(id)
        );
      `);
      
      // 创建房间用户关联表
      await db.exec(`
        CREATE TABLE IF NOT EXISTS room_users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          room_id INTEGER,
          user_id INTEGER,
          joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (room_id) REFERENCES rooms(id),
          FOREIGN KEY (user_id) REFERENCES users(id),
          UNIQUE(room_id, user_id)
        );
      `);
      
      // 创建默认大厅房间
      const defaultRoom = await db.get(`SELECT * FROM rooms WHERE is_default = true`);
      if (!defaultRoom) {
        await db.run(`
          INSERT INTO rooms (name, is_default, status)
          VALUES ('大厅', true, 'idle')
        `);
      }
      
    } catch (error) {
      console.error('数据库初始化失败:', error);
    }
  },
  
  // 处理登录
  async handleLogin(request, db, corsHeaders) {
    try {
      // 直接返回固定的登录成功响应
      const response = {
        "success": true,
        "user": {
          "id": "1",
          "username": "紫罗兰",
          "role": "owner"
        }
      };
      
      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
      
    } catch (error) {
      return new Response(JSON.stringify({ success: false, message: error.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  },
  
  // 获取用户列表
  async getUsers(request, db, corsHeaders) {
    try {
      const users = await db.all(`SELECT id, username, role, online FROM users`);
      return new Response(JSON.stringify(users), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  },
  
  // 创建用户
  async createUser(request, db, corsHeaders) {
    try {
      const data = await request.json();
      const { username, createdBy } = data;
      
      if (!username) {
        return new Response(JSON.stringify({ success: false, message: '用户名不能为空' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      
      // 检查用户是否已存在
      const existingUser = await db.get(`SELECT * FROM users WHERE username = ?`, [username]);
      if (existingUser) {
        return new Response(JSON.stringify({ success: false, message: '用户名已存在' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      
      // 创建新用户，默认密码为 123456
      const result = await db.run(`
        INSERT INTO users (username, password, role)
        VALUES (?, '123456', 'user')
      `, [username]);
      
      const newUser = {
        id: result.lastInsertRowid,
        username,
        role: 'user',
        online: false
      };
      
      return new Response(JSON.stringify({ success: true, user: newUser }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
      
    } catch (error) {
      return new Response(JSON.stringify({ success: false, message: error.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  },
  
  // 更新用户角色
  async updateUserRole(request, db, corsHeaders, userId) {
    try {
      const data = await request.json();
      const { role, userId: operatorId } = data;
      
      if (!role) {
        return new Response(JSON.stringify({ success: false, message: '角色不能为空' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      
      // 检查操作权限
      const operator = await db.get(`SELECT role FROM users WHERE id = ?`, [operatorId]);
      if (!operator || (operator.role !== 'owner' && operator.role !== 'admin')) {
        return new Response(JSON.stringify({ success: false, message: '没有权限设置角色' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      
      // 更新角色
      await db.run(`UPDATE users SET role = ? WHERE id = ?`, [role, userId]);
      
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
      
    } catch (error) {
      return new Response(JSON.stringify({ success: false, message: error.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  },
  
  // 删除用户
  async deleteUser(request, db, corsHeaders, userId) {
    try {
      const data = await request.json();
      const { userId: operatorId } = data;
      
      // 检查操作权限
      const operator = await db.get(`SELECT role FROM users WHERE id = ?`, [operatorId]);
      if (!operator || (operator.role !== 'owner' && operator.role !== 'admin')) {
        return new Response(JSON.stringify({ success: false, message: '没有权限删除用户' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      
      // 删除用户
      await db.run(`DELETE FROM users WHERE id = ?`, [userId]);
      
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
      
    } catch (error) {
      return new Response(JSON.stringify({ success: false, message: error.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  },
  
  // 获取房间列表
  async getRooms(request, db, corsHeaders) {
    try {
      const rooms = await db.all(`
        SELECT r.id, r.name, r.status, r.is_default as isDefault, r.timer, r.created_by
        FROM rooms r
      `);
      
      // 为每个房间获取成员列表
      for (const room of rooms) {
        const users = await db.all(`
          SELECT u.id, u.username, u.role, u.online
          FROM room_users ru
          JOIN users u ON ru.user_id = u.id
          WHERE ru.room_id = ?
        `, [room.id]);
        room.users = users;
      }
      
      return new Response(JSON.stringify(rooms), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  },
  
  // 创建房间
  async createRoom(request, db, corsHeaders) {
    try {
      const data = await request.json();
      const { name, createdBy } = data;
      
      if (!name) {
        return new Response(JSON.stringify({ success: false, message: '房间名称不能为空' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      
      // 检查房间是否已存在
      const existingRoom = await db.get(`SELECT * FROM rooms WHERE name = ?`, [name]);
      if (existingRoom) {
        return new Response(JSON.stringify({ success: false, message: '房间名称已存在' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      
      // 创建新房间
      const result = await db.run(`
        INSERT INTO rooms (name, status, created_by)
        VALUES (?, 'idle', ?)
      `, [name, createdBy]);
      
      const newRoom = {
        id: result.lastInsertRowid,
        name,
        status: 'idle',
        isDefault: false,
        timer: 0,
        created_by: createdBy,
        users: []
      };
      
      return new Response(JSON.stringify({ success: true, room: newRoom }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
      
    } catch (error) {
      return new Response(JSON.stringify({ success: false, message: error.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  },
  
  // 获取房间成员
  async getRoomUsers(request, db, corsHeaders, roomId) {
    try {
      const users = await db.all(`
        SELECT u.id, u.username, u.role, u.online
        FROM room_users ru
        JOIN users u ON ru.user_id = u.id
        WHERE ru.room_id = ?
      `, [roomId]);
      
      return new Response(JSON.stringify(users), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  },
  
  // 踢出用户
  async kickUser(request, db, corsHeaders, roomId) {
    try {
      const data = await request.json();
      const { userId, kickedBy } = data;
      
      // 检查操作权限
      const operator = await db.get(`SELECT role FROM users WHERE id = ?`, [kickedBy]);
      if (!operator || (operator.role !== 'owner' && operator.role !== 'admin')) {
        return new Response(JSON.stringify({ success: false, message: '没有权限踢出用户' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      
      // 踢出用户（从房间中移除）
      await db.run(`DELETE FROM room_users WHERE room_id = ? AND user_id = ?`, [roomId, userId]);
      
      return new Response(JSON.stringify({ success: true, message: '用户已成功踢出' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
      
    } catch (error) {
      return new Response(JSON.stringify({ success: false, message: error.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  },
  
  // 删除房间
  async deleteRoom(request, db, corsHeaders, roomId) {
    try {
      const data = await request.json();
      const { userId } = data;
      
      // 检查操作权限
      const operator = await db.get(`SELECT role FROM users WHERE id = ?`, [userId]);
      if (!operator || (operator.role !== 'owner' && operator.role !== 'admin')) {
        return new Response(JSON.stringify({ success: false, message: '没有权限删除房间' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      
      // 检查是否为默认大厅
      const room = await db.get(`SELECT is_default FROM rooms WHERE id = ?`, [roomId]);
      if (room && room.is_default) {
        return new Response(JSON.stringify({ success: false, message: '默认大厅不能删除' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      
      // 删除房间用户关联
      await db.run(`DELETE FROM room_users WHERE room_id = ?`, [roomId]);
      
      // 删除房间
      await db.run(`DELETE FROM rooms WHERE id = ?`, [roomId]);
      
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
      
    } catch (error) {
      return new Response(JSON.stringify({ success: false, message: error.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  },
  
  // 修改密码
  async changePassword(request, db, corsHeaders) {
    try {
      const data = await request.json();
      const { oldPassword, newPassword, userId } = data;
      
      if (!oldPassword || !newPassword) {
        return new Response(JSON.stringify({ success: false, message: '旧密码和新密码不能为空' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      
      // 验证旧密码
      const user = await db.get(`SELECT password FROM users WHERE id = ?`, [userId]);
      if (!user || user.password !== oldPassword) {
        return new Response(JSON.stringify({ success: false, message: '旧密码错误' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      
      // 更新密码
      await db.run(`UPDATE users SET password = ? WHERE id = ?`, [newPassword, userId]);
      
      return new Response(JSON.stringify({ success: true, message: '密码修改成功' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
      
    } catch (error) {
      return new Response(JSON.stringify({ success: false, message: error.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  }
};
