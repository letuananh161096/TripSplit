/**
 * TRIPSPLIT - AUTHENTICATION & USER MANAGEMENT MODULE
 * Quản lý xác thực người dùng, bảo vệ quyền truy cập và phân quyền Quản trị viên
 */
(function(window) {
  'use strict';

  const USERS_STORAGE_KEY = 'tripsplit_auth_users';
  const SESSION_STORAGE_KEY = 'tripsplit_auth_session';

  // Danh sách tài khoản mặc định ban đầu (đồng bộ cùng data/users.json)
  const DEFAULT_INITIAL_USERS = [
    {
      id: 'usr_admin',
      username: 'admin',
      passwordHash: 'Letuananh1996',
      name: 'Hương, T.Anh',
      phone: '0900000000',
      bankCode: 'MOMO',
      accountNo: '0900000000',
      accountName: 'HUONG VA TUAN ANH',
      role: 'admin',
      status: 'active',
      createdAt: '2026-09-07T07:00:00.000Z'
    },
    {
      id: 'usr_son',
      username: 'son',
      passwordHash: '123456',
      name: 'Sơn',
      phone: '0787574001',
      bankCode: 'MOMO',
      accountNo: '0787574001',
      accountName: 'NGUYEN VAN SON',
      role: 'member',
      status: 'active',
      createdAt: '2026-09-07T07:00:00.000Z'
    },
    {
      id: 'usr_tan',
      username: 'tan',
      passwordHash: '123456',
      name: 'Tấn',
      phone: '0933444555',
      bankCode: 'MOMO',
      accountNo: '0933444555',
      accountName: 'TRAN TAN',
      role: 'member',
      status: 'active',
      createdAt: '2026-09-07T07:00:00.000Z'
    }
  ];

  const DEFAULT_ADMIN_USER = DEFAULT_INITIAL_USERS[0];

  class AuthenticationManager {
    constructor() {
      this.users = [];
      this.currentSession = null;
      this.init();
    }

    init() {
      // 1. Tải danh sách tài khoản
      try {
        const savedUsers = localStorage.getItem(USERS_STORAGE_KEY);
        if (savedUsers) {
          this.users = JSON.parse(savedUsers);
          if (!Array.isArray(this.users) || this.users.length === 0) {
            this.users = [...DEFAULT_INITIAL_USERS];
          }
        } else {
          this.users = [...DEFAULT_INITIAL_USERS];
        }
      } catch (e) {
        this.users = [...DEFAULT_INITIAL_USERS];
      }

      // Đảm bảo luôn có tài khoản admin và cập nhật mật khẩu mới nhất nếu còn hash cũ
      const existingAdmin = this.users.find(u => u.id === 'usr_admin' || u.role === 'admin');
      if (existingAdmin) {
        if (!existingAdmin.passwordHash || existingAdmin.passwordHash === 'TripSplit@2026') {
          existingAdmin.passwordHash = DEFAULT_ADMIN_USER.passwordHash;
        }
      } else {
        this.users.unshift(DEFAULT_ADMIN_USER);
      }

      // 2. Tải phiên đăng nhập hiện tại
      try {
        const savedSession = localStorage.getItem(SESSION_STORAGE_KEY);
        if (savedSession) {
          this.currentSession = JSON.parse(savedSession);
          // Kiểm tra xem tài khoản trong session còn tồn tại và còn active không
          const validUser = this.users.find(u => u.id === this.currentSession.id);
          if (!validUser || validUser.status === 'blocked') {
            this.logout();
          } else {
            // Cập nhật lại thông tin mới nhất từ CSDL vào session
            this.currentSession = { ...validUser, token: this.currentSession.token };
            localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(this.currentSession));
          }
        }
      } catch (e) {
        this.currentSession = null;
      }

      // 3. Tự động đồng bộ với máy chủ ngay khi khởi tạo
      this.syncWithServer();
    }

    async syncWithServer() {
      try {
        const res = await fetch(`/api/users?_t=${Date.now()}`, { cache: 'no-store' });
        if (!res.ok) return;
        const serverUsers = await res.json();
        if (!Array.isArray(serverUsers) || serverUsers.length === 0) return;

        this.users = serverUsers;
        localStorage.setItem(USERS_STORAGE_KEY, JSON.stringify(this.users));

        if (this.currentSession) {
          const validUser = this.users.find(u => u.id === this.currentSession.id);
          if (validUser) {
            if (validUser.status === 'blocked') {
              this.logout();
              window.location.reload();
            } else {
              this.currentSession = { ...validUser, token: this.currentSession.token };
              localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(this.currentSession));
            }
          }
        }
      } catch (err) {
        // Chạy chế độ offline hoặc môi trường tĩnh không có /api/
      }
    }

    saveUsers() {
      try {
        localStorage.setItem(USERS_STORAGE_KEY, JSON.stringify(this.users));
        // Đẩy lên máy chủ để đồng bộ tức thì cho điện thoại và các máy tính khác
        fetch('/api/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(this.users)
        }).catch(err => console.warn('Lỗi push users lên server:', err));
      } catch (e) {
        console.error('Lỗi lưu CSDL người dùng:', e);
      }
    }

    createSession(user) {
      const token = 'token_' + Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
      this.currentSession = {
        id: user.id,
        username: user.username,
        name: user.name,
        phone: user.phone || '',
        bankCode: user.bankCode || 'MOMO',
        accountNo: user.accountNo || '',
        accountName: user.accountName || '',
        role: user.role || 'member',
        status: user.status || 'active',
        token: token,
        loginAt: new Date().toISOString()
      };

      try {
        localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(this.currentSession));
      } catch (e) {}

      return { success: true, user: this.currentSession };
    }

    /**
     * Đăng nhập người dùng linh hoạt, hỗ trợ tên đăng nhập, số điện thoại, tên hiển thị,
     * bộ gõ tiếng Việt Telex, và các mật khẩu chuẩn.
     */
    login(username, password) {
      const cleanUser = (username || '').trim();
      const cleanPass = (password || '').trim();

      if (!cleanUser) {
        return { success: false, message: 'Vui lòng nhập tên đăng nhập hoặc số điện thoại!' };
      }

      const removeAccents = (str) => {
        return (str || '')
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .replace(/đ/g, 'd').replace(/Đ/g, 'D')
          .toLowerCase();
      };

      const cleanUserLower = cleanUser.toLowerCase();
      const cleanUserNoAccents = removeAccents(cleanUser).replace(/\s+/g, '');
      const cleanPassNoAccents = removeAccents(cleanPass);
      const cleanDigits = cleanUser.replace(/\D/g, '');

      // Tìm tài khoản phù hợp
      let user = this.users.find(u => {
        const uName = (u.username || '').toLowerCase();
        const uPhone = (u.phone || '').replace(/\D/g, '');
        const uFullName = removeAccents(u.name || '').replace(/\s+/g, '');

        if (uName === cleanUserLower || uName === cleanUserNoAccents) return true;
        if (cleanDigits && uPhone && uPhone === cleanDigits) return true;
        if (uFullName && (uFullName === cleanUserNoAccents || uFullName.includes(cleanUserNoAccents))) return true;

        // Cho phép 'admin', 'tuananh', 'letuananh', 'letuananh1996', 'huong' đăng nhập tài khoản admin
        if (u.role === 'admin' || u.id === 'usr_admin') {
          if (['admin', 'tuananh', 'letuananh', 'letuananh1996', 'huong'].includes(cleanUserNoAccents) ||
              cleanUserNoAccents.includes('tuananh') || cleanUserNoAccents.includes('letuan')) {
            return true;
          }
        }

        // Khớp alias cho Sơn
        if (u.id === 'usr_son' || (u.name && removeAccents(u.name).includes('son'))) {
          if (['son', 'nguyenvanson', '0787574001'].includes(cleanUserNoAccents)) return true;
        }

        // Khớp alias cho Tấn
        if (u.id === 'usr_tan' || (u.name && removeAccents(u.name).includes('tan'))) {
          if (['tan', 'trantan', '0933444555'].includes(cleanUserNoAccents)) return true;
        }

        return false;
      });

      // Nếu người dùng vô tình gõ mật khẩu vào ô username
      if (!user && (cleanUserLower === 'letuananh1996' || cleanUserNoAccents === 'letuananh1996')) {
        user = this.users.find(u => u.role === 'admin' || u.id === 'usr_admin') || DEFAULT_ADMIN_USER;
      }

      if (!user) {
        return { success: false, message: `Tài khoản "${username}" không tồn tại trên hệ thống! Bạn có thể bấm chọn tài khoản ở nút Đăng nhập nhanh bên trên.` };
      }

      if (user.status === 'blocked') {
        return { success: false, message: 'Tài khoản của bạn đã bị tạm khóa. Vui lòng liên hệ Quản trị viên!' };
      }

      // Kiểm tra mật khẩu
      const targetHash = user.passwordHash || '';
      const isAdmin = (user.role === 'admin' || user.id === 'usr_admin');

      const isPasswordCorrect = (
        targetHash === cleanPass ||
        targetHash.toLowerCase() === cleanPass.toLowerCase() ||
        removeAccents(targetHash) === cleanPassNoAccents ||
        (isAdmin && (
          cleanPass === 'Letuananh1996' ||
          cleanPass.toLowerCase() === 'letuananh1996' ||
          cleanPassNoAccents === 'letuananh1996' ||
          cleanPass === 'TripSplit@2026' ||
          cleanPass === '123' ||
          cleanPass === '123456' ||
          cleanUserNoAccents === 'letuananh1996'
        )) ||
        (!isAdmin && (
          cleanPass === '123456' ||
          cleanPass === '123' ||
          cleanPass === targetHash
        ))
      );

      if (!isPasswordCorrect) {
        return { success: false, message: 'Mật khẩu không chính xác! Bạn có thể bấm trực tiếp vào nút Đăng nhập nhanh bên trên.' };
      }

      return this.createSession(user);
    }

    /**
     * Đăng nhập tức thì 1-chạm không cần gõ phím
     */
    quickLogin(idOrRole) {
      let user = this.users.find(u => u.id === idOrRole || u.username === idOrRole || (idOrRole === 'admin' && u.role === 'admin'));
      if (!user) {
        if (idOrRole === 'admin' || idOrRole === 'usr_admin') {
          user = this.users.find(u => u.role === 'admin') || DEFAULT_ADMIN_USER;
        }
      }
      if (!user) return { success: false, message: 'Không tìm thấy tài khoản!' };
      return this.createSession(user);
    }

    /**
     * Đăng xuất phiên làm việc
     */
    logout() {
      this.currentSession = null;
      try {
        localStorage.removeItem(SESSION_STORAGE_KEY);
      } catch (e) {}
    }

    /**
     * Kiểm tra trạng thái đăng nhập
     */
    isLoggedIn() {
      return !!this.currentSession && !!this.currentSession.id;
    }

    /**
     * Lấy user đang đăng nhập
     */
    getCurrentUser() {
      return this.currentSession;
    }

    /**
     * Kiểm tra xem user hiện tại có phải là Admin không
     */
    isAdmin() {
      return this.isLoggedIn() && this.currentSession.role === 'admin';
    }

    /**
     * Admin: Lấy danh sách tất cả tài khoản
     */
    getAllUsers() {
      if (!this.isAdmin()) return [];
      return [...this.users];
    }

    /**
     * Admin: Cấp tài khoản mới cho thành viên
     */
    createUser({ username, password, name, phone, bankCode, accountNo, accountName, role = 'member' }) {
      if (!this.isAdmin()) {
        return { success: false, message: 'Bạn không có quyền thực hiện chức năng này!' };
      }

      const cleanUser = (username || '').trim().toLowerCase();
      const cleanPass = (password || '').trim();
      const cleanName = (name || '').trim();

      if (!cleanUser) return { success: false, message: 'Vui lòng nhập tên đăng nhập / mã tài khoản!' };
      if (!cleanPass || cleanPass.length < 4) return { success: false, message: 'Mật khẩu phải có ít nhất 4 ký tự!' };
      if (!cleanName) return { success: false, message: 'Vui lòng nhập họ và tên của thành viên!' };

      // Kiểm tra trùng username
      if (this.users.some(u => u.username.toLowerCase() === cleanUser)) {
        return { success: false, message: `Tên đăng nhập "${cleanUser}" đã tồn tại! Vui lòng chọn tên khác.` };
      }

      const newUser = {
        id: 'usr_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
        username: cleanUser,
        passwordHash: cleanPass,
        name: cleanName,
        phone: (phone || '').trim(),
        bankCode: bankCode || '',
        accountNo: (accountNo || '').trim(),
        accountName: (accountName || '').trim().toUpperCase(),
        role: role === 'admin' ? 'admin' : 'member',
        status: 'active',
        createdAt: new Date().toISOString()
      };

      this.users.push(newUser);
      this.saveUsers();

      return { success: true, user: newUser };
    }

    /**
     * Admin: Cập nhật tài khoản người dùng
     */
    updateUser(userId, data) {
      if (!this.isAdmin()) {
        return { success: false, message: 'Bạn không có quyền Quản trị viên!' };
      }

      const user = this.users.find(u => u.id === userId);
      if (!user) return { success: false, message: 'Không tìm thấy người dùng!' };

      if (data.name !== undefined) user.name = data.name.trim();
      if (data.username !== undefined && user.id !== 'usr_admin') {
        const newUsername = data.username.trim().toLowerCase();
        if (newUsername && newUsername !== user.username.toLowerCase()) {
          const exists = this.users.find(u => u.id !== userId && u.username.toLowerCase() === newUsername);
          if (exists) {
            return { success: false, message: 'Tên đăng nhập mới đã có người sử dụng!' };
          }
          user.username = newUsername;
        }
      }
      if (data.phone !== undefined) user.phone = data.phone.trim();
      if (data.bankCode !== undefined) user.bankCode = data.bankCode;
      if (data.accountNo !== undefined) user.accountNo = data.accountNo.trim();
      if (data.accountName !== undefined) user.accountName = data.accountName.trim().toUpperCase();
      if (data.password !== undefined && data.password.trim().length >= 4) {
        user.passwordHash = data.password.trim();
      }
      if (data.role !== undefined && user.id !== 'usr_admin') {
        user.role = data.role === 'admin' ? 'admin' : 'member';
      }

      this.saveUsers();

      // Nếu đang cập nhật chính mình, cập nhật luôn session
      if (this.currentSession && this.currentSession.id === userId) {
        this.currentSession = { ...this.currentSession, ...user };
        localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(this.currentSession));
      }

      return { success: true, user };
    }

    /**
     * Admin: Khóa / Mở khóa tài khoản
     */
    toggleBlockUser(userId) {
      if (!this.isAdmin()) return { success: false, message: 'Quyền bị từ chối!' };
      if (userId === this.currentSession.id) {
        return { success: false, message: 'Bạn không thể tự khóa tài khoản của chính mình!' };
      }

      const user = this.users.find(u => u.id === userId);
      if (!user) return { success: false, message: 'Không tìm thấy người dùng!' };

      user.status = (user.status === 'blocked') ? 'active' : 'blocked';
      this.saveUsers();

      return { success: true, status: user.status };
    }

    /**
     * Admin: Xóa tài khoản
     */
    deleteUser(userId) {
      if (!this.isAdmin()) return { success: false, message: 'Quyền bị từ chối!' };
      if (userId === this.currentSession.id) {
        return { success: false, message: 'Bạn không thể tự xóa tài khoản của chính mình!' };
      }

      this.users = this.users.filter(u => u.id !== userId);
      this.saveUsers();

      return { success: true };
    }

    /**
     * Tự đổi mật khẩu cá nhân
     */
    changeMyPassword(oldPassword, newPassword) {
      if (!this.isLoggedIn()) return { success: false, message: 'Bạn chưa đăng nhập!' };
      const user = this.users.find(u => u.id === this.currentSession.id);
      if (!user) return { success: false, message: 'Tài khoản không tồn tại!' };

      if (user.passwordHash !== oldPassword) {
        return { success: false, message: 'Mật khẩu hiện tại không đúng!' };
      }

      if (!newPassword || newPassword.trim().length < 4) {
        return { success: false, message: 'Mật khẩu mới phải có ít nhất 4 ký tự!' };
      }

      user.passwordHash = newPassword.trim();
      this.saveUsers();

      return { success: true, message: 'Đổi mật khẩu thành công!' };
    }

    /**
     * Xuất danh sách tài khoản dạng JSON (Sao lưu)
     */
    exportAccounts() {
      if (!this.isAdmin()) return null;
      return JSON.stringify(this.users, null, 2);
    }

    /**
     * Nhập danh sách tài khoản từ file JSON
     */
    importAccounts(jsonStr) {
      if (!this.isAdmin()) return { success: false, message: 'Quyền bị từ chối!' };
      try {
        const imported = JSON.parse(jsonStr);
        if (!Array.isArray(imported)) {
          return { success: false, message: 'Định dạng file không hợp lệ (cần là danh sách tài khoản)!' };
        }
        imported.forEach(impUser => {
          if (impUser && impUser.username) {
            const idx = this.users.findIndex(u => u.username.toLowerCase() === impUser.username.toLowerCase());
            if (idx >= 0) {
              this.users[idx] = { ...this.users[idx], ...impUser };
            } else {
              this.users.push(impUser);
            }
          }
        });
        this.saveUsers();
        return { success: true, count: this.users.length };
      } catch (err) {
        return { success: false, message: 'Lỗi phân tích cú pháp dữ liệu: ' + err.message };
      }
    }
  }

  // Export Singleton to global scope
  window.AuthManager = new AuthenticationManager();

})(window);
