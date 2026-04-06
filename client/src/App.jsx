import { useState, useEffect, useCallback, useRef } from 'react'
import io from 'socket.io-client'
import './App.css'

const API_URL = 'https://api.teamup.us.ci';
const statusColors = {
  matching: '#ea4335',
  gaming: '#34a853',
  idle: '#1a73e8',
  default: '#eef2f6',
  lobby: '#333333'
}

const statusLabels = {
  matching: '匹配中',
  gaming: '游戏中',
  idle: '空闲'
}

function App() {
  const [socket, setSocket] = useState(null)
  const [user, setUser] = useState(null)
  const [rooms, setRooms] = useState([])
  const [users, setUsers] = useState([])
  const [currentRoom, setCurrentRoom] = useState(null)
  const [roomUsers, setRoomUsers] = useState([])
  const [loginForm, setLoginForm] = useState({ username: '', password: '' })
  const [newRoomName, setNewRoomName] = useState('')
  const [newUserName, setNewUserName] = useState('')
  const [showAddUser, setShowAddUser] = useState(false)
  const [showDeleteRoom, setShowDeleteRoom] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [showDeleteUserConfirm, setShowDeleteUserConfirm] = useState(false)
  const [roomToDelete, setRoomToDelete] = useState(null)
  const [userToDelete, setUserToDelete] = useState(null)
  const [isMobile, setIsMobile] = useState(false)
  const [error, setError] = useState('')
  const [messages, setMessages] = useState([])
  const [messageInput, setMessageInput] = useState('')
  const [peer, setPeer] = useState(null)
  const [peerId, setPeerId] = useState(null)
  const [localStream, setLocalStream] = useState(null)
  const [isMicOn, setIsMicOn] = useState(false)
  const [isDeafen, setIsDeafen] = useState(false)
  const [connections, setConnections] = useState({})
  const [remoteAudios, setRemoteAudios] = useState({})
  const [showChangePassword, setShowChangePassword] = useState(false)
  const [changePasswordForm, setChangePasswordForm] = useState({ oldPassword: '', newPassword: '', confirmPassword: '' })
  const [changePasswordError, setChangePasswordError] = useState('')
  const [syncButtonDisabled, setSyncButtonDisabled] = useState(false)
  const [showKickUser, setShowKickUser] = useState(false)
  const [userToKick, setUserToKick] = useState(null)
  const hasRestoredMicRef = useRef(false)
  const localStreamRef = useRef(null)
  const voiceControlsRef = useRef(null)
  // 使用 ref 来存储最新的 currentRoom，避免闭包问 ?
  const currentRoomRef = useRef(null)
  // 使用 ref 来存储是否需要向新成员发起呼叫
  const shouldCallNewMembersRef = useRef(false)
  // 使用 ref 来存储最新的 isMicOn 状态，避免闭包问题
  const isMicOnRef = useRef(false)
  // 使用 ref 来标记是否正在同步
  const shouldSyncRef = useRef(false)
  // 使用 ref 来标记用户是否已经主动进入过房间
  const hasEnteredRoomRef = useRef(false)
  // 使用 ref 来存储之前的房间ID
  const previousRoomIdRef = useRef(null)
  // 使用 ref 来存储定时器ID
  const retryTimerRef = useRef(null)

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.matchMedia('(pointer: coarse)').matches)
    }
    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])

  // 页面开始加载时
  

  // 初始化时间戳
  const startTime = performance.now()

  // 立即从sessionStorage读取状 ?
  useEffect(() => {
    
    
    // 立即从localStorage和sessionStorage读取上次的用户和开麦状 ?
    let storedUser = localStorage.getItem('user')
    if (!storedUser) {
      storedUser = sessionStorage.getItem('user')
    }
    const storedMicState = sessionStorage.getItem('isMicOn')
    
    
    
    if (storedUser && storedUser !== "undefined") {
      try {
        const parsedUser = JSON.parse(storedUser)
        setUser(parsedUser)
      } catch (error) {
        console.error('解析用户信息失败:', error)
        // 清除损坏的存储数据
        localStorage.removeItem('user')
        sessionStorage.removeItem('user')
      }
    }
    
    // 检查是否已经有 Peer 实例
    if (!window.peer) {
      // 直接使用官方公共服务器 0.peerjs.com
      const peerInitStartTime = performance.now()
      const newPeer = new Peer(undefined, {
        host: '0.peerjs.com',
        port: 443,
        path: '/',
        secure: true
      })
      
      newPeer.on('open', (id) => {
        const connectTime = performance.now() - peerInitStartTime
        
        setPeerId(id)
        window.currentPeerId = id
        setPeer(newPeer)
        window.peer = newPeer
      })
      
      newPeer.on('error', (error) => {
        console.error(`[${performance.now() - startTime}ms] PeerJS 初始化错误`, error)
      })
      
      // 设置呼叫处理
      newPeer.on('call', (call) => {
        // 无论本地是否有流，都要应答
        // 使用 ref 获取最新的 localStream
        const currentStream = localStreamRef.current
        if (currentStream) {
          call.answer(currentStream)
        } else {
          call.answer()
        }
        // 监听远程流并播放
        call.on('stream', (remoteStream) => {
          
          const audio = new Audio()
          audio.srcObject = remoteStream
          audio.play()
          
          // 保存音频元素引用
          setRemoteAudios(prev => ({ ...prev, [call.peer]: audio }))
        })
      })
    } else {
      
      if (window.currentPeerId) {
        setPeerId(window.currentPeerId)
      }
    }
    
    // 并行获取用户列表和房间列 ?
    Promise.all([
      // 获取用户列表
      fetch(`${API_URL}/api/users`)
        .then(res => res.json())
        .then(data => {
          
          setUsers(data)
          
        })
        .catch(err => {
          console.error('获取用户列表失败:', err)
        }),
      
      // 获取房间列表
      fetch(`${API_URL}/api/rooms`)
        .then(res => res.json())
        .then(data => {
          
          setRooms(sortRooms(data))
          
          // 找到默认大厅房间，不使用本地缓存的房间状态
          const lobbyRoom = data.find(room => room.isDefault)
          if (lobbyRoom) {
            // 确保 isDefault 属性存在
            const roomWithIsDefault = { ...lobbyRoom, isDefault: lobbyRoom.isDefault || false }
            

            setCurrentRoom(roomWithIsDefault)
            sessionStorage.setItem('currentRoom', JSON.stringify(roomWithIsDefault))
          } else {
            // 如果找不到大厅，清空本地缓存
            sessionStorage.removeItem('currentRoom')

            setCurrentRoom(null)
          }
        })
        .catch(err => {
          console.error('获取房间列表失败:', err)
        })
    ]).then(() => {
      
    })
    
    return () => {
      Object.values(connections).forEach(call => call.close())
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop())
      }
      Object.values(remoteAudios).forEach(audio => {
        if (audio) {
          audio.pause()
          audio.srcObject = null
        }
      })
      if (window.peer) {
        window.peer.destroy()
        window.peer = null
      }
    }
  }, [])

  // 同步 currentRoom  ?ref
  useEffect(() => {
    currentRoomRef.current = currentRoom
    
  }, [currentRoom])

  // 同步 isMicOn  ?ref
  useEffect(() => {
    isMicOnRef.current = isMicOn
  }, [isMicOn])

  // 监听 rooms 状态变化，打印成员信息
  useEffect(() => {
    if (rooms.length > 0) {
      rooms.forEach(room => {
        if (room.users && room.users.length > 0) {
          
        }
      })
    }
  }, [rooms])

  // 检查语音按钮DOM元素
  useEffect(() => {
    
    if (currentRoom && !currentRoom.isDefault) {
      
      // 延迟检查，确保DOM已更 ?
      const checkIntervals = [100, 300, 500, 1000, 2000]
      checkIntervals.forEach((delay, index) => {
        setTimeout(() => {
          const voiceControls = document.querySelector('.voice-controls')
          
          if (voiceControls) {
            const rect = voiceControls.getBoundingClientRect()
            const computedStyle = window.getComputedStyle(voiceControls)
            const buttons = voiceControls.querySelectorAll('button')
            
            buttons.forEach((btn, btnIndex) => {
              const btnRect = btn.getBoundingClientRect()
              const btnStyle = window.getComputedStyle(btn)
            })
          } else {
            
          }
        }, delay)
      })
    } else {
      
    }
  }, [currentRoom])

  // 恢复开麦状态- 当用户进入房间后检查是否需要恢复开麦
  useEffect(() => {
    const restoreMicState = async () => {
      // 检查是否已经恢复过
      if (hasRestoredMicRef.current) return
      
      // 确保已经进入房间且不是大厅
      if (!currentRoom || currentRoom.isDefault) return
      
      // 确保已经有peer 实例
      const currentPeer = window.peer || peer
      if (!currentPeer) return
      
      // 确保已经有peerId
      if (!peerId) return
      
      // 确保房间成员列表已经加载
      if (roomUsers.length === 0) return
      
      // 标记已经尝试恢复
      hasRestoredMicRef.current = true
      
      // 检查是否需要恢复闭听状态
      const savedDeafenState = sessionStorage.getItem('isDeafen')
      if (savedDeafenState === 'true') {
        setIsDeafen(true)
        
      }
      
      // 检查是否需要恢复开麦状态
      const savedMicState = sessionStorage.getItem('isMicOn')
      if (savedMicState !== 'true') return
      
      
      
      try {
        // 获取麦克风流
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        
        setLocalStream(stream)
        // 同时更新 ref
        localStreamRef.current = stream
        
        setIsMicOn(true)
        // 设置标志，表示需要向新成员发起呼叫
        shouldCallNewMembersRef.current = true
        
        
      } catch (error) {
        console.error('恢复开麦状态失败', error)
        // 恢复失败，清除保存的状态
        sessionStorage.removeItem('isMicOn')
        // 重置标记，允许下次尝试
        hasRestoredMicRef.current = false
      }
    }
    
    // 立即执行，不延迟
    restoreMicState()
  }, [currentRoom, peer, peerId, roomUsers])

  // 当房间成员变化时，如果有新成员加入且当前正在开麦，向新成员发起呼叫
  useEffect(() => {
    // 只有在开麦状态下才处理
    if (!isMicOn || !localStreamRef.current) return
    
    const currentPeer = window.peer || peer
    if (!currentPeer || !peerId) return
    
    // 延迟执行，确保新成员已经准备好接收呼 ?
    const timer = setTimeout(() => {
      // 检查是否有新成员需要呼 ?
      roomUsers.forEach(otherUser => {
        if (otherUser.peerId && otherUser.peerId !== peerId && otherUser.peerId.trim() !== '') {
          // 检查是否已经呼叫过
          if (!connections[otherUser.peerId]) {
            
            try {

              const call = currentPeer.call(otherUser.peerId, localStreamRef.current)
              setConnections(prev => ({ ...prev, [otherUser.peerId]: call }))
            } catch (error) {
              console.error('向新成员发起呼叫时出 ?', error)
            }
          }
        }
      })
    }, 1000) // 延迟 1 秒，确保新成员准备好
    
    return () => clearTimeout(timer)
  }, [roomUsers, isMicOn, peer, peerId, connections])

  const fetchRooms = async () => {
    try {
      const res = await fetch(`${API_URL}/api/rooms`)
      const data = await res.json()
      setRooms(sortRooms(data))
    } catch (err) {
      console.error('获取房间列表失败:', err)
    }
  }

  const fetchUsers = async (updateCurrentUser = true) => {
    try {
      const res = await fetch(`${API_URL}/api/users`)
      const data = await res.json()
      
      setUsers(data)
      
      // 更新当前登录用户的信息，特别是角色信息
      if (user && updateCurrentUser) {
        const currentUserInfo = data.find(u => u.id === user.id)
        if (currentUserInfo) {
          const updatedUser = {
            ...user,
            role: currentUserInfo.role,
            online: currentUserInfo.online
          }
          setUser(updatedUser)
          // 同时更新sessionStorage中的用户信息
          sessionStorage.setItem('user', JSON.stringify(updatedUser))
        }
      }
    } catch (err) {
      console.error('获取用户列表失败:', err)
    }
  }

  const fetchRoomUsers = async (roomId) => {
    try {
      const res = await fetch(`${API_URL}/api/rooms/${roomId}/users`)
      const data = await res.json()
      setRoomUsers(data)
    } catch (err) {
      console.error('获取房间成员列表失败:', err)
    }
  }

  // 房间排序函数
  const sortRooms = (roomsList) => {
    // 分离大厅和非大厅房间
    const lobbyRoom = roomsList.find(room => room.isDefault)
    const nonLobbyRooms = roomsList.filter(room => !room.isDefault)
    
    // 状态优先级：matching > gaming > idle
    const statusPriority = {
      'matching': 3,
      'gaming': 2,
      'idle': 1
    }
    
    // 对非大厅房间排序
    nonLobbyRooms.sort((a, b) => {
      // 首先按状态排序
      const statusDiff = statusPriority[b.status] - statusPriority[a.status]
      if (statusDiff !== 0) {
        return statusDiff
      }
      // 状态相同时，按 timer 从大到小排序
      return (b.timer || 0) - (a.timer || 0)
    })
    
    // 大厅房间始终在最顶部
    if (lobbyRoom) {
      return [lobbyRoom, ...nonLobbyRooms]
    }
    return nonLobbyRooms
  }

  const handleLogin = async (e) => {
    e.preventDefault()
    setError('')
    
    try {
      const res = await fetch(`${API_URL}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(loginForm)
      })
      const data = await res.json()
      
      if (data.success && data.user) {
        setUser(data.user)
        // 保存用户信息到 localStorage 和 sessionStorage
        try {
          const userJson = JSON.stringify(data.user)
          if (userJson) {
            localStorage.setItem('user', userJson)
            sessionStorage.setItem('user', userJson)
          }
        } catch (error) {
          console.error('存储用户信息失败:', error)
        }
        fetchUsers()
        window.location.href = '/'
      } else {
        setError(data.message || '登录失败')
      }
    } catch (err) {
      setError('网络错误，请稍后重试')
    }
  }

  const handleCreateRoom = async (e) => {
    e.preventDefault()
    if (!newRoomName.trim()) return

    try {
      const res = await fetch(`${API_URL}/api/rooms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newRoomName, createdBy: user.id })
      })
      const data = await res.json()
      
      if (data.success) {
        setNewRoomName('')
      }
    } catch (err) {
      console.error('创建房间失败:', err)
    }
  }

  const handleAddUser = async (e) => {
    e.preventDefault()
    if (!newUserName.trim()) return

    try {
      const res = await fetch(`${API_URL}/api/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: newUserName, createdBy: user.id })
      })
      const data = await res.json()
      
      if (data.success) {
        setNewUserName('')
        setShowAddUser(false)
        alert(`用户创建成功！用户名: ${data.user.username}, 密码: 123456`)
        fetchUsers()
      } else {
        alert(data.message || '创建用户失败')
      }
    } catch (err) {
      alert('网络错误，请稍后重试')
    }
  }

  const enterRoom = useCallback((room) => {
    
    if (!socket) {
      
      return
    }
    
    // 如果当前在房间中，先清理语音连接
    if (currentRoom && currentRoom.id !== room.id) {
      
      // 停止本地麦克风流
      if (localStream) {
        localStream.getTracks().forEach(track => track.stop())
        setLocalStream(null)
      }
      // 关闭所 ?WebRTC 连接
      Object.values(connections).forEach(call => call.close())
      setConnections({})
      // 停止所有远程音 ?
      Object.values(remoteAudios).forEach(audio => {
        if (audio) {
          audio.pause()
          audio.srcObject = null
        }
      })
      setRemoteAudios({})
      // 重置开麦状 ?
      setIsMicOn(false)
      // 保留开麦状态在 sessionStorage 中，以便切换房间后恢复
      // 重置恢复标记
      hasRestoredMicRef.current = false
      
      socket.emit('leaveRoom', { roomId: currentRoom.id, user })
    }
    
    // 发 ?enterRoom 事件时包 ?peerId
    const userWithPeerId = { ...user, peerId: peerId }
    
    socket.emit('enterRoom', { roomId: room.id, user: userWithPeerId })
    setCurrentRoom(room)
    // 清空消息列表，只显示当前房间的消 ?
    setMessages([])
    // 保存当前房间到sessionStorage
    sessionStorage.setItem('currentRoom', JSON.stringify(room))
  }, [socket, currentRoom, user, peerId, localStream, connections, remoteAudios])

  const leaveRoom = useCallback(() => {
    if (!socket || !currentRoom) return
    
    
    
    // 发送离开房间请求，包含 peerId
    const userWithPeerId = { ...user, peerId: peerId }
    socket.emit('leaveRoom', { roomId: currentRoom.id, user: userWithPeerId })
    
    // 如果正在开麦，先关闭麦克风
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop())
      setLocalStream(null)
    }
    // 关闭所有连 ?
    Object.values(connections).forEach(call => call.close())
    setConnections({})
    // 停止所有远程音 ?
    Object.values(remoteAudios).forEach(audio => {
      if (audio) {
        audio.pause()
        audio.srcObject = null
      }
    })
    setRemoteAudios({})
    setIsMicOn(false)
    setIsDeafen(false)
    // 重置恢复标记
    hasRestoredMicRef.current = false
    
    // 找到大厅房间
    const lobbyRoom = rooms.find(room => room.isDefault)
    if (lobbyRoom) {
      // 直接进入大厅，不调用 enterRoom 避免状态不一 ?
      
      socket.emit('enterRoom', { roomId: lobbyRoom.id, user: userWithPeerId })
      setCurrentRoom(lobbyRoom)
      setRoomUsers([])
      setMessages([])
      sessionStorage.setItem('currentRoom', JSON.stringify(lobbyRoom))
    } else {
      // 如果找不到大厅，清除房间状 ?

      setCurrentRoom(null)
      setRoomUsers([])
      setMessages([])
      // 清除sessionStorage中的房间信息
      sessionStorage.removeItem('currentRoom')
    }
  }, [socket, currentRoom, user, peerId, rooms, localStream, connections, remoteAudios])

  const changeRoomStatus = useCallback((status) => {
    if (!socket || !currentRoom) {
      
      return;
    }
    
    
    
    // 立即更新本地状态，让按钮颜色立即变 ?
    const updatedRoom = { ...currentRoom, status }

    setCurrentRoom(updatedRoom)
    // 保存到sessionStorage
    sessionStorage.setItem('currentRoom', JSON.stringify(updatedRoom))
    
    // 发送到服务器，包含用户信息
    
    socket.emit('changeRoomStatus', { roomId: currentRoom.id, status, user })
    
  }, [socket, currentRoom, user])

  const handleRoomClick = (room) => {
    if (isMobile) {
      // 清除定时器
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      enterRoom(room)
    }
  }

  const handleRoomDoubleClick = (room) => {
    if (!isMobile) {
      // 清除定时器
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      enterRoom(room)
    }
  }

  const handleDeleteRoom = (roomId, roomName) => {
    
    setRoomToDelete({ id: roomId, name: roomName });
    setShowDeleteConfirm(true);
  }

  const confirmDeleteRoom = async () => {
    if (roomToDelete) {
      
      try {
        const res = await fetch(`${API_URL}/api/rooms/${roomToDelete.id}`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: user.id })
        })
        const data = await res.json()
        
        if (!data.success) {
          alert(data.message || '删除房间失败')
        }
        setShowDeleteConfirm(false);
        setRoomToDelete(null);
        // 重置删除模式，使按钮变回「删除房间 ?
        setShowDeleteRoom(false);
      } catch (err) {
        console.error('删除房间失败:', err);
        alert('网络错误，请稍后重试');
        setShowDeleteConfirm(false);
        setRoomToDelete(null);
        // 重置删除模式，使按钮变回「删除房间 ?
        setShowDeleteRoom(false);
      }
    }
  }

  const cancelDeleteRoom = () => {
    
    setShowDeleteConfirm(false);
    setRoomToDelete(null);
    // 重置删除模式，使按钮变回「删除房间 ?
    setShowDeleteRoom(false);
  }

  const handleSetAdmin = async (userId, username, newRole) => {
    try {
      const res = await fetch(`${API_URL}/api/users/${userId}/role`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: newRole, userId: user.id })
      })
      const data = await res.json()
      if (data.success) {
        fetchUsers()
      } else {
        alert(data.message || '设置角色失败')
      }
    } catch (err) {
      alert('网络错误，请稍后重试')
    }
  }

  const handleDeleteUser = (userId, username) => {
    setUserToDelete({ id: userId, username: username });
    setShowDeleteUserConfirm(true);
  }

  const confirmDeleteUser = async () => {
    if (userToDelete) {
      try {
        const res = await fetch(`${API_URL}/api/users/${userToDelete.id}`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: user.id })
        })
        const data = await res.json()
        if (data.success) {
          fetchUsers()
        } else {
          alert(data.message || '删除用户失败')
        }
        setShowDeleteUserConfirm(false);
        setUserToDelete(null);
      } catch (err) {
        alert('网络错误，请稍后重试');
        setShowDeleteUserConfirm(false);
        setUserToDelete(null);
      }
    }
  }

  const cancelDeleteUser = () => {
    setShowDeleteUserConfirm(false);
    setUserToDelete(null);
  }

  const handleChangePassword = async (e) => {
    e.preventDefault()
    setChangePasswordError('')
    
    const { oldPassword, newPassword, confirmPassword } = changePasswordForm
    
    if (!oldPassword || !newPassword || !confirmPassword) {
      setChangePasswordError('请填写所有字段')
      return
    }
    
    if (newPassword !== confirmPassword) {
      setChangePasswordError('新密码和确认密码不一致')
      return
    }
    
    try {
      const res = await fetch(`${API_URL}/api/user/change-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldPassword, newPassword, userId: user.id })
      })
      const data = await res.json()
      
      if (data.success) {
        alert('密码已修改，请重新登录')
        handleLogout()
      } else {
        setChangePasswordError(data.message || '修改密码失败')
      }
    } catch (err) {
      setChangePasswordError('网络错误，请稍后重试')
    }
  }

  const handleLogout = () => {
    if (socket && currentRoom) {
      // 先发送离开房间请求
      socket.emit('leaveRoom', { roomId: currentRoom.id, user })
    }
    if (socket) {
      socket.close()
    }
    // 如果正在开麦，关闭麦克 ?
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop())
    }
    // 关闭所有连 ?
    Object.values(connections).forEach(call => call.close())
    // 清除localStorage和sessionStorage中的用户信息和房间信 ?
    localStorage.removeItem('user')
    sessionStorage.removeItem('user')
    sessionStorage.removeItem('currentRoom')
    sessionStorage.removeItem('isMicOn')
    setUser(null)
    setSocket(null)

    setCurrentRoom(null)
    setRoomUsers([])
    setRooms([])
    setMessages([])
    setLocalStream(null)
    setConnections({})
    setIsMicOn(false)
    hasRestoredMicRef.current = false
    // 跳转到登录页面
    window.location.href = '/'
  }

  const handleSync = async () => {
    // 禁用同步按钮，添加防抖
    setSyncButtonDisabled(true)
    
    try {
      // 检查并确保 socket 连接
      if (socket) {
        // 如果 socket 断开，尝试重连
        if (!socket.connected) {
          // 手动连接
          socket.connect()
          
          // 等待连接成功，最多等待 3 秒
          let reconnectAttempts = 0
          while (!socket.connected && reconnectAttempts < 30) {
            await new Promise(resolve => setTimeout(resolve, 100))
            reconnectAttempts++
          }
        }
        
        // 发送同步开始事件
        if (socket.connected) {
          socket.emit('syncStart', { roomId: currentRoom?.id })
        }
      }
      
      // 重新拉取房间列表
      await fetchRooms()
      
      // 重新拉取用户列表（不更新当前用户状态，避免触发 socket 重建）
      await fetchUsers(false)
      
      // 重新拉取当前房间的成员列表
      if (currentRoom) {
        await fetchRoomUsers(currentRoom.id)
      }
    } catch (err) {
      console.error('同步数据失败:', err)
    } finally {
      // 发送同步结束事件
      if (socket && socket.connected) {
        socket.emit('syncEnd', { roomId: currentRoom?.id })
      }
      // 3秒后重新启用同步按钮
      setTimeout(() => {
        setSyncButtonDisabled(false)
      }, 3000)
    }
  }

  const confirmKickUser = async () => {
    if (!userToKick || !currentRoom) return
    
    try {
      const res = await fetch(`${API_URL}/api/rooms/${currentRoom.id}/kick`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: userToKick, kickedBy: user.id })
      })
      const data = await res.json()
      
      if (data.success) {
        alert('用户已成功踢出')
        // 刷新房间成员列表
        if (currentRoom) {
          await fetchRoomUsers(currentRoom.id)
        }
      } else {
        alert(data.message || '踢出用户失败')
      }
    } catch (err) {
      console.error('踢出用户失败:', err)
      alert('网络错误，请稍后重试')
    } finally {
      setShowKickUser(false)
      setUserToKick(null)
    }
  }

  const sendMessage = useCallback(() => {
    if (!socket || !currentRoom || !messageInput.trim()) return
    
    const message = {
      roomId: currentRoom.id,
      userId: user.id,
      username: user.username,
      content: messageInput.trim(),
      timestamp: new Date().toLocaleTimeString()
    }
    
    socket.emit('send_message', message)
    setMessageInput('')
    
    // 自动滚动到底 ?
    setTimeout(() => {
      const chatMessages = document.querySelector('.chat-messages')
      if (chatMessages) {
        chatMessages.scrollTop = chatMessages.scrollHeight
      }
    }, 100)
  }, [socket, currentRoom, user, messageInput])

  // 发起呼叫的辅助函数
  const initiateCalls = useCallback((stream, users) => {
    const currentPeer = window.peer || peer
    if (!currentPeer || !peerId) return
    
    const newConnections = {}
    users.forEach(otherUser => {
      if (otherUser.peerId && otherUser.peerId !== peerId && otherUser.peerId.trim() !== '') {
        try {
          const call = currentPeer.call(otherUser.peerId, stream)
          newConnections[otherUser.peerId] = call
        } catch (error) {
          console.error('发起呼叫时出 ?', error)
        }
      }
    })
    
    setConnections(prev => ({ ...prev, ...newConnections }))
  }, [peer, peerId])

  // 开 ?闭麦功能
  const toggleMic = async () => {
    const currentPeer = window.peer || peer
    if (!currentPeer || !currentRoom || currentRoom.isDefault) return
    
    if (!isMicOn) {
      // 开麦
      try {
        // 获取麦克风流
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        
        setLocalStream(stream)
        // 同时更新 ref
        localStreamRef.current = stream
        
        // 遍历当前房间的所有其他成员，发起呼叫
        const newConnections = {}
        roomUsers.forEach(otherUser => {
          if (otherUser.peerId && otherUser.peerId !== peerId && otherUser.peerId.trim() !== '') {
            try {
              const call = currentPeer.call(otherUser.peerId, stream)
              newConnections[otherUser.peerId] = call
            } catch (error) {
              console.error('发起呼叫时出 ?', error)
            }
          }
        })
        setConnections(newConnections)
        setIsMicOn(true)
        // 保存开麦状态到 sessionStorage
        sessionStorage.setItem('isMicOn', 'true')
        // 设置标志，表示需要向新成员发起呼叫
        shouldCallNewMembersRef.current = true
        
      } catch (error) {
        console.error('获取麦克风权限失 ?', error)
        alert('无法获取麦克风权限，请检查浏览器设置')
      }
    } else {
      // 闭麦
      
      // 停止音频流
      if (localStream) {
        localStream.getTracks().forEach(track => track.stop())
        setLocalStream(null)
        // 同时清除 ref
        localStreamRef.current = null
      }
      
      // 关闭所有连接
      Object.values(connections).forEach(call => call.close())
      setConnections({})
      setIsMicOn(false)
      // 清除开麦状态
      sessionStorage.removeItem('isMicOn')
      // 重置标志
      shouldCallNewMembersRef.current = false
      
    }
  }

  // 闭听/开听功 ?
  const toggleDeafen = () => {
    if (!currentRoom || currentRoom.isDefault) return
    
    if (!isDeafen) {
      // 闭听 - 暂停所有远程音 ?
      
      Object.values(remoteAudios).forEach(audio => {
        if (audio && !audio.paused) {
          audio.pause()
        }
      })
      setIsDeafen(true)
      sessionStorage.setItem('isDeafen', 'true')
      
    } else {
      // 开 ?- 恢复播放所有远程音 ?
      
      Object.values(remoteAudios).forEach(audio => {
        if (audio && audio.paused) {
          audio.play()
        }
      })
      setIsDeafen(false)
      sessionStorage.removeItem('isDeafen')
      
    }
  }

  // 测试呼叫功能
  const testCall = () => {
    const currentPeer = window.peer || peer
    if (!currentPeer || !currentRoom || currentRoom.isDefault) return
    
    // 从当前房间成员列表中获取另一个用户的 peerId
    const otherUser = roomUsers.find(user => user.peerId && user.peerId !== peerId)
    if (otherUser) {
      
      try {
        currentPeer.call(otherUser.peerId, null)
      } catch (error) {
        console.error('发起呼叫时出 ?', error)
      }
    } else {
      
    }
  }

  // WebSocket 连接和事件处 ?
  useEffect(() => {
    if (user) {
      
      
      // 保存用户信息到sessionStorage
      sessionStorage.setItem('user', JSON.stringify(user))
      
      // 关闭旧的 socket 连接
      if (socket) {
        socket.close()
      }
      
      const newSocket = io('http://localhost:3001', {
        transports: ['websocket'],
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000
      })
      
      setSocket(newSocket)

      newSocket.on('connect', () => {
        
        
        // 发 ?join 事件时包 ?peerId
        const userWithPeerId = { ...user, peerId: peerId }
        
        newSocket.emit('join', userWithPeerId)
        
        
        // 如果已经 ?peerId，发 ?update-peer-id 事件
        if (peerId) {
          
          newSocket.emit('update-peer-id', { userId: user.id, peerId: peerId })
        }
        
        // 处理之前的房间
        previousRoomIdRef.current = null
        newSocket.on('previousRoom', (data) => {
          previousRoomIdRef.current = data.roomId;
        })
        
        // 先获取最新的房间列表，然后进入适当的房间
        fetch(`${API_URL}/api/rooms`)
          .then(res => res.json())
          .then(updatedRooms => {
            
            setRooms(sortRooms(updatedRooms))
            
            // 选择要进入的房间
            let targetRoom = null
            // 恢复之前的房间
            if (previousRoomIdRef.current) {
              targetRoom = updatedRooms.find(room => room.id === previousRoomIdRef.current)
            }
            
            // 如果没有之前的房间，进入默认大厅
            if (!targetRoom) {
              targetRoom = updatedRooms.find(room => room.isDefault)

            }
            
            if (targetRoom) {
              // 延迟进入房间，确保 peerId 已经获取
              const enterRoomWithDelay = () => {
                const currentPeerId = window.currentPeerId || peerId
                
                if (currentPeerId) {
                  // 清除定时器
                  if (retryTimerRef.current) {
                    clearTimeout(retryTimerRef.current);
                    retryTimerRef.current = null;
                  }
                  const userWithPeerId = { ...user, peerId: currentPeerId }
                  

                  newSocket.emit('enterRoom', { roomId: targetRoom.id, user: userWithPeerId })
                  // 同时发送 update-peer-id 确保 peerId 已更新
                  newSocket.emit('update-peer-id', { userId: user.id, peerId: currentPeerId })
                } else {
                  // 如果还没有 peerId，延迟重试
                  // 清除已有的定时器
                  if (retryTimerRef.current) {
                    clearTimeout(retryTimerRef.current);
                  }
                  // 存储新的定时器ID
                  retryTimerRef.current = setTimeout(enterRoomWithDelay, 500)
                  return
                }
              }
              enterRoomWithDelay()
              

              setCurrentRoom(targetRoom)
              sessionStorage.setItem('currentRoom', JSON.stringify(targetRoom))
            }
          })
          .catch(err => {
            console.error('获取房间列表失败:', err)
          })
      })

      newSocket.on('connect_error', (error) => {
        console.error('WebSocket连接错误:', error)
      })

      newSocket.on('disconnect', (reason) => {
      })

      newSocket.on('roomsUpdated', (updatedRooms) => {
        setRooms(sortRooms(updatedRooms));
        
        setCurrentRoom(prev => {
          if (prev) {
            const updated = updatedRooms.find(r => r.id === prev.id);
            return updated || prev;
          }
          return prev;
        });
      })

      newSocket.on('roomUsersUpdated', (users) => {
        const latestCurrentRoom = currentRoomRef.current
        if (latestCurrentRoom) {
          
        }
        setRoomUsers(users)
        
        // 如果用户正在开麦且需要向新成员发起呼叫，并且不在同步状态
        if (isMicOnRef.current && localStreamRef.current && shouldCallNewMembersRef.current && !shouldSyncRef.current) {
          initiateCalls(localStreamRef.current, users)
        }
        
        // 同时更新当前房间的状态，确保状态同 ?
        if (currentRoom) {
          
          fetch(`${API_URL}/api/rooms`)
            .then(res => res.json())
            .then(updatedRooms => {
              
              setRooms(sortRooms(updatedRooms))
              const sortedRooms = sortRooms(updatedRooms)
              const updatedRoom = sortedRooms.find(r => r.id === currentRoom.id)
              
              if (updatedRoom) {
                // 确保 isDefault 属性存 ?
                const roomWithIsDefault = { ...updatedRoom, isDefault: updatedRoom.isDefault || false }
                

                setCurrentRoom(roomWithIsDefault)
                sessionStorage.setItem('currentRoom', JSON.stringify(roomWithIsDefault))
              } else {
                // 房间被删除，进入大厅
                const lobbyRoom = sortedRooms.find(room => room.isDefault)
                if (lobbyRoom) {

                  setCurrentRoom(lobbyRoom)
                  sessionStorage.setItem('currentRoom', JSON.stringify(lobbyRoom))
                }
              }
            })
        }
      })

      // 监听用户添加成功事件
      newSocket.on('user_added', (data) => {


        fetchUsers()
      })

      // 监听房间删除事件
      newSocket.on('room_deleted', (data) => {


        // 重新获取房间列表
        fetch(`${API_URL}/api/rooms`)
          .then(res => res.json())
          .then(updatedRooms => {
            setRooms(sortRooms(updatedRooms))
            // 只有当当前在被删除的房间中时，才切换到大 ?
            if (currentRoom && currentRoom.id === data.roomId) {
              // 找到默认大厅房间
              const sortedRooms = sortRooms(updatedRooms)
              const lobbyRoom = sortedRooms.find(room => room.isDefault)
              
              if (lobbyRoom) {
                
                newSocket.emit('enterRoom', { roomId: lobbyRoom.id, user })
                setCurrentRoom(lobbyRoom)
                // 保存大厅到sessionStorage
                sessionStorage.setItem('currentRoom', JSON.stringify(lobbyRoom))
                
              }
            }
          })
          .catch(err => {
            console.error('获取房间列表失败:', err)
          })
      })

      // 监听用户移动事件
      newSocket.on('user_moved', (data) => {
        
        
        // 只有当移动的是当前用户时，才更新界面
        if (data.userId === user?.id) {
          // 重新获取房间列表
          fetch(`${API_URL}/api/rooms`)
            .then(res => res.json())
            .then(updatedRooms => {
              
              setRooms(sortRooms(updatedRooms))
              // 找到目标房间（大厅）
              const sortedRooms = sortRooms(updatedRooms)
              const targetRoom = sortedRooms.find(room => room.id === data.toRoom)
              
              if (targetRoom) {
                
                

                setCurrentRoom(targetRoom)
                // 保存到sessionStorage
                sessionStorage.setItem('currentRoom', JSON.stringify(targetRoom))
                
              }
            })
            .catch(err => {
              console.error('获取房间列表失败:', err)
            })
        }
      })

      // 监听用户更新事件
      newSocket.on('user_updated', (data) => {
        
        fetchUsers()
      })

      // 监听用户删除事件
      newSocket.on('user_deleted', (data) => {
        
        fetchUsers()
      })

      // 监听用户状态更新事 ?
      newSocket.on('user_status_updated', (updatedUser) => {
        
        setUsers(prevUsers => prevUsers.map(user => 
          user.id === updatedUser.id ? { ...user, online: updatedUser.online } : user
        ))
      })

      // 监听用户离开消息
      newSocket.on('user_left', (data) => {
        
        // 不再调用fetchRooms()，完全依赖roomUsersUpdated事件来更新状 ?
        // 这样可以避免用旧的房间列表覆盖新的状 ?
      })

      // 监听新消 ?
      newSocket.on('new_message', (message) => {
        
        setMessages(prev => [...prev, message])
        // 自动滚动到底 ?
        setTimeout(() => {
          const chatMessages = document.querySelector('.chat-messages')
          if (chatMessages) {
            chatMessages.scrollTop = chatMessages.scrollHeight
          }
        }, 100)
      })

      // 监听语音提醒事件
      newSocket.on('voiceReminder', () => {
        const audio = new Audio('/reminder.mp3')
        audio.play().catch(error => {
          console.error('播放提醒音频失败:', error)
        })
      })

      // 监听被踢出事件
      newSocket.on('kicked', (data) => {
        alert(data.message)
        // 跳回登录页面
        handleLogout()
      })

      // 监听同步开始事件
      newSocket.on('syncStart', () => {
        shouldSyncRef.current = true
      })

      // 监听同步结束事件
      newSocket.on('syncEnd', (data) => {
        shouldSyncRef.current = false
      })

      return () => {
        if (newSocket) {
          newSocket.close()
        }
      }
    }
  }, [user])

  if (!user) {
    return (
      <div className="login-container">
        <div className="login-box">
          <h1>聊天室登录</h1>
          <form onSubmit={handleLogin}>
            <div className="form-group">
              <label>用户名</label>
              <input
                type="text"
                value={loginForm.username}
                onChange={(e) => setLoginForm({ ...loginForm, username: e.target.value })}
                placeholder="请输入用户名"
                required
              />
            </div>
            <div className="form-group">
              <label>密码</label>
              <input
                type="password"
                value={loginForm.password}
                onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })}
                placeholder="请输入密码"
                required
              />
            </div>
            {error && <div className="error">{error}</div>}
            <button type="submit" className="btn-primary">登录</button>
          </form>

        </div>
      </div>
    )
  }

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="header-left">
          <h1>聊天室</h1>
          <button 
            className="btn-sync" 
            onClick={handleSync} 
            disabled={syncButtonDisabled}
          >
            同步
          </button>
        </div>
        <div className="user-info">
          <span>欢迎, {user.username} {user.role === 'owner' && '(房主)'}</span>
          <button className="btn-secondary" onClick={handleLogout}>退出</button>
        </div>
      </header>

      {showAddUser && (
        <div className="modal-overlay" onClick={() => setShowAddUser(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>添加新用户</h3>
            <form onSubmit={handleAddUser}>
              <div className="form-group">
                <label>用户名</label>
                <input
                  type="text"
                  value={newUserName}
                  onChange={(e) => setNewUserName(e.target.value)}
                  placeholder="请输入用户名"
                  required
                />
              </div>
              <p className="hint">默认密码: 123456</p>
              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => setShowAddUser(false)}>取消</button>
                <button type="submit" className="btn-primary">创建</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showDeleteConfirm && roomToDelete && (
        <div className="modal-overlay" onClick={cancelDeleteRoom}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>删除房间</h3>
            <p>确定要删除房间 <strong>{roomToDelete.name}</strong> 吗？</p>
            <div className="modal-actions">
              <button type="button" className="btn-secondary" onClick={cancelDeleteRoom}>取消</button>
              <button type="button" className="btn-primary" onClick={confirmDeleteRoom}>确定</button>
            </div>
          </div>
        </div>
      )}

      {showDeleteUserConfirm && userToDelete && (
        <div className="modal-overlay" onClick={cancelDeleteUser}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>删除用户</h3>
            <p>确定要删除用户 <strong>{userToDelete.username}</strong> 吗？</p>
            <div className="modal-actions">
              <button type="button" className="btn-secondary" onClick={cancelDeleteUser}>取消</button>
              <button type="button" className="btn-primary" onClick={confirmDeleteUser}>确定</button>
            </div>
          </div>
        </div>
      )}

      {showChangePassword && (
        <div className="modal-overlay" onClick={() => setShowChangePassword(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>修改密码</h3>
            <form onSubmit={handleChangePassword}>
              <div className="form-group">
                <label>旧密码</label>
                <input
                  type="password"
                  value={changePasswordForm.oldPassword}
                  onChange={(e) => setChangePasswordForm({ ...changePasswordForm, oldPassword: e.target.value })}
                  placeholder="请输入旧密码"
                  required
                />
              </div>
              <div className="form-group">
                <label>新密码</label>
                <input
                  type="password"
                  value={changePasswordForm.newPassword}
                  onChange={(e) => setChangePasswordForm({ ...changePasswordForm, newPassword: e.target.value })}
                  placeholder="请输入新密码"
                  required
                />
              </div>
              <div className="form-group">
                <label>确认新密码</label>
                <input
                  type="password"
                  value={changePasswordForm.confirmPassword}
                  onChange={(e) => setChangePasswordForm({ ...changePasswordForm, confirmPassword: e.target.value })}
                  placeholder="请确认新密码"
                  required
                />
              </div>
              {changePasswordError && <div className="error">{changePasswordError}</div>}
              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => setShowChangePassword(false)}>取消</button>
                <button type="submit" className="btn-primary">修改密码</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showKickUser && (
        <div className="modal-overlay" onClick={() => setShowKickUser(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>踢出用户</h3>
            <div className="form-group">
              <label>选择要踢出的用户</label>
              <select 
                value={userToKick || ''}
                onChange={(e) => setUserToKick(e.target.value)}
                className="kick-user-select"
              >
                <option value="">请选择用户</option>
                {roomUsers.filter(u => u.id !== user.id && u.role !== 'owner').map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.username}
                  </option>
                ))}
              </select>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn-secondary" onClick={() => setShowKickUser(false)}>取消</button>
              <button 
                type="button" 
                className="btn-primary" 
                onClick={confirmKickUser}
                disabled={!userToKick}
              >
                确认踢出
              </button>
            </div>
          </div>
        </div>
      )}

      <main className="main-content">
        <div className="content-left">
          <div className="rooms-section">
            <div className="section-header">
            <h2>房间列表</h2>
            <div className="room-actions">
              {(user.role === 'owner' || user.role === 'admin') && (
                <form onSubmit={handleCreateRoom} className="create-room-form">
                  <input
                    type="text"
                    value={newRoomName}
                    onChange={(e) => setNewRoomName(e.target.value)}
                    placeholder="输入房间名称"
                  />
                  <button type="submit" className="btn-primary">创建房间</button>
                </form>
              )}
              {(user.role === 'owner' || user.role === 'admin') && (
                <button 
                  className="btn-secondary"
                  onClick={() => setShowDeleteRoom(!showDeleteRoom)}
                >
                  {showDeleteRoom ? '取消删除' : '删除房间'}
                </button>
              )}
            </div>
          </div>

            <div className="rooms-grid">
              {rooms.map((room) => {
                // 按房间状态计算颜 ?
                let roomColor = statusColors.default;
                if (room.isDefault) {
                  roomColor = statusColors.lobby;
                } else if (room.status === 'matching') {
                  roomColor = statusColors.matching; // 红色
                } else if (room.status === 'gaming') {
                  roomColor = statusColors.gaming; // 绿色
                } else {
                  roomColor = statusColors.idle; // 蓝色
                }
                
                // 打印房间成员信息
                
                
                // 显示成员列表
                const renderMembers = (users) => {
                  if (!users || users.length === 0) return ''
                  if (users.length <= 3) {
                    return users.map(u => u.username).join('、')
                  } else {
                    return users.slice(0, 3).map(u => u.username).join('、') + `…+${users.length - 3}`
                  }
                }
                
                // 格式化计时
                const formatTime = (seconds) => {
                  const mins = Math.floor(seconds / 60)
                  const secs = seconds % 60
                  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
                }
                
                // 获取房间计时（使用后端返回的数据 ?
                const roomTimer = room.timer || 0
                const showTimer = !room.isDefault && (room.status === 'matching' || room.status === 'gaming')
                
                return (
                  <div
                    key={room.id}
                    className={`room-card ${currentRoom?.id === room.id ? 'active' : ''}`}
                    style={{ backgroundColor: roomColor }}
                    onClick={() => handleRoomClick(room)}
                    onDoubleClick={() => handleRoomDoubleClick(room)}
                  >
                    <div className="room-info">
                      <h3>{room.name}</h3>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
                        <span className="room-status">{statusLabels[room.status] || '空闲'}</span>
                        {showTimer && (
                          <span style={{ fontSize: '12px', opacity: 0.9 }}>
                            · {formatTime(roomTimer)}
                          </span>
                        )}
                      </div>
                      {!room.isDefault && room.users && room.users.length > 0 && (
                        <div className="room-members">
                          {renderMembers(room.users)}
                        </div>
                      )}
                    </div>
                    <div className="room-users-count">
                      <span>{room.userCount || 0} 人在线</span>
                    </div>
                    {room.isDefault && <span className="default-badge">大厅</span>}
                    {showDeleteRoom && !room.isDefault && (user.role === 'owner' || user.role === 'admin') && (
                      <button 
                        className="delete-room-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteRoom(room.id, room.name);
                        }}
                        title="删除房间"
                      >
                        ×
                      </button>
                    )}
                  </div>
                )
              })}
            </div>

            <p className="interaction-hint">
              {isMobile ? '点击房间进入' : '双击房间进入'}
            </p>
          </div>

          {(() => {
            
            
            return null
          })()}
          {currentRoom && (
            (() => {
              
              return null
            })()
          )}
          {currentRoom && (
            <div className="current-room-section">
              <div className="current-room-header">
                <div>
                  <h2>当前房间: {currentRoom.name}</h2>

                </div>
                {(() => {
                  
                  if (!currentRoom) {
                    
                    return null
                  }
                  
                  
                  if (!currentRoom.isDefault) {
                    
                    return (
                      <div className="voice-controls" ref={voiceControlsRef}>
                        <button className="btn-secondary" onClick={toggleMic}>{isMicOn ? '闭麦' : '开麦'}</button>
                        <button className="btn-secondary" onClick={toggleDeafen}>{isDeafen ? '开听' : '闭听'}</button>

                      </div>
                    )
                  } else {
                    
                    return null
                  }
                })()}
                <button className="btn-secondary" onClick={leaveRoom}>离开房间</button>
              </div>

              {/* 只有子房间才显示状态按钮，大厅不显示*/}
              {!currentRoom.isDefault && (
                <div className="room-status-controls">
                  <span>房间状态</span>
                  <div className="status-buttons">
                    {/* 找到当前用户在房间中的状态*/}
                    {(() => {
                      const currentUserInRoom = roomUsers.find(u => u.id === user.id);
                      const userStatus = currentUserInRoom ? currentUserInRoom.status : 'idle';

                      return (
                        <>
                          <button
                            className={`status-btn ${userStatus === 'matching' ? 'active' : ''}`}
                            style={{ backgroundColor: userStatus === 'matching' ? statusColors.matching : '#999999' }}
                            onClick={() => changeRoomStatus('matching')}
                          >
                            匹配中
                          </button>
                          <button
                            className={`status-btn ${userStatus === 'gaming' ? 'active' : ''}`}
                            style={{ backgroundColor: userStatus === 'gaming' ? statusColors.gaming : '#999999' }}
                            onClick={() => changeRoomStatus('gaming')}
                          >
                            游戏中
                          </button>
                          <button
                            className={`status-btn ${userStatus === 'idle' ? 'active' : ''}`}
                            style={{ backgroundColor: userStatus === 'idle' ? statusColors.idle : '#999999' }}
                            onClick={() => changeRoomStatus('idle')}
                          >
                            空闲
                          </button>
                        </>
                      );
                    })()}
                  </div>
                </div>
              )}

              <div className="room-users-list">
                <div className="room-users-header">
                  <h3>在线用户 ({roomUsers.length})</h3>
                  {(user.role === 'owner' || user.role === 'admin') && (
                    <button 
                      className="btn-kick"
                      onClick={() => setShowKickUser(true)}
                    >
                      踢出
                    </button>
                  )}
                </div>
                <ul>
                  {roomUsers.map((u) => (
                    <li key={u.id} className={u.id === user.id ? 'me' : ''}>
                      {u.username} {u.id === user.id && '(我)'}
                    </li>
                  ))}
                </ul>
              </div>

              {/* 聊天功能 */}
              <div className="chat-section">
                <h3>聊天</h3>
                <div className="chat-messages">
                  {messages.map((msg, index) => (
                    <div key={index} className={`message ${msg.userId === user.id ? 'own' : ''}`}>
                      <div className="message-header">
                        <span className="message-username">{msg.username}</span>
                        <span className="message-time">{msg.timestamp}</span>
                      </div>
                      <div className="message-content">{msg.content}</div>
                    </div>
                  ))}
                </div>
                <div className="chat-input">
                  <input
                    type="text"
                    value={messageInput}
                    onChange={(e) => setMessageInput(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
                    placeholder="输入消息..."
                  />
                  <button onClick={sendMessage}>发送</button>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="content-right">
          <div className="members-section">
            <div className="members-header">
              <h2>成员管理</h2>
              <div className="header-buttons">
                <button 
                  className="btn-secondary add-user-btn"
                  style={{ marginRight: '8px' }}
                  onClick={() => setShowChangePassword(true)}
                >
                  修改密码
                </button>
                {(user.role === 'owner' || user.role === 'admin') && (
                  <button 
                    className="btn-primary add-user-btn"
                    onClick={() => setShowAddUser(true)}
                  >
                    + 添加用户
                  </button>
                )}
              </div>
            </div>
            <div className="members-list">
              <h3>所有用户({users.length})</h3>
              <ul>
                {users.map((u) => (
                  <li key={u.id} className={u.id === user.id ? 'me' : ''}>
                    <div className="member-info">
                      <span className="member-username">{u.username}</span>
                      <span className={`member-status ${u.online ? 'online' : 'offline'}`}>
                        {u.online ? '在线' : '离线'}
                      </span>
                    </div>
                    <div className="member-actions">
                      {(u.role === 'owner' || u.role === 'admin') && (
                        <span className={`member-role ${u.role}`}>
                          {u.role === 'owner' ? '房主' : '管理员'}
                        </span>
                      )}
                      {user.role === 'owner' && u.role !== 'owner' && (
                        <div className="member-buttons">
                          <button 
                            className="btn-secondary small"
                            onClick={() => handleSetAdmin(u.id, u.username, u.role === 'admin' ? 'user' : 'admin')}
                          >
                            {u.role === 'admin' ? '取消管理员' : '设为管理员'}
                          </button>
                          <button 
                            className="btn-secondary small danger"
                            onClick={() => handleDeleteUser(u.id, u.username)}
                          >
                            删除
                          </button>
                        </div>
                      )}
                      {user.role === 'admin' && u.role !== 'owner' && (
                        <div className="member-buttons">
                          <button 
                            className="btn-secondary small danger"
                            onClick={() => handleDeleteUser(u.id, u.username)}
                          >
                            删除
                          </button>
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}

export default App
