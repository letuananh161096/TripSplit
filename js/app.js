/**
 * TRIPSPLIT - MAIN APPLICATION CONTROLLER
 */
(function() {
  'use strict';

  // Storage Keys
  const USER_PROFILE_KEY = 'tripsplit_user_profile';

  // State
  let trips = [];
  let currentTrip = null;
  let activeTab = 'tab-overview';
  let activeCategoryFilter = 'all';
  let activeDateFilter = 'all';
  let customDateFilter = '';
  let selectedCategory = 'food';
  let selectedSplitType = 'equal';
  let tempReceiptData = null;
  let deferredInstallPrompt = null;
  let currentQrTransaction = null;
  let waitingTripCode = null;
  let waitingApprovalPollTimer = null;
  let serverLocalIp = null;
  let pendingJoinRoomCode = null;

  // Icons Mapping
  const CATEGORY_ICONS = {
    food: '🍽️',
    transport: '🚗',
    hotel: '🏨',
    ticket: '🎟️',
    drink: '☕',
    shopping: '🛍️',
    entertainment: '🎪',
    other: '💡'
  };

  const CATEGORY_NAMES = {
    food: 'Ăn uống',
    transport: 'Di chuyển',
    hotel: 'Khách sạn',
    ticket: 'Vé / Tour',
    drink: 'Cafe & Bar',
    shopping: 'Mua sắm',
    entertainment: 'Giải trí',
    other: 'Khác'
  };

  const AVATAR_COLORS = [
    'linear-gradient(135deg, #10b981, #059669)',
    'linear-gradient(135deg, #38bdf8, #0284c7)',
    'linear-gradient(135deg, #f59e0b, #d97706)',
    'linear-gradient(135deg, #ec4899, #be185d)',
    'linear-gradient(135deg, #8b5cf6, #6d28d9)',
    'linear-gradient(135deg, #14b8a6, #0f766e)'
  ];

  // ==========================================================================
  // USER PROFILE MANAGEMENT (Lưu trữ cục bộ trên từng máy khách & đồng bộ Auth)
  // ==========================================================================
  function getUserProfile() {
    // Nếu đã đăng nhập qua AuthManager, ưu tiên lấy từ tài khoản đang đăng nhập
    if (window.AuthManager && window.AuthManager.isLoggedIn()) {
      const authUser = window.AuthManager.getCurrentUser();
      if (authUser) {
        return {
          id: authUser.id,
          name: authUser.name || 'Bạn',
          phone: authUser.phone || '',
          bankCode: 'MOMO',
          accountNo: authUser.accountNo || authUser.phone || '',
          accountName: authUser.accountName || '',
          role: authUser.role || 'member',
          colorIdx: 0
        };
      }
    }

    try {
      const saved = localStorage.getItem(USER_PROFILE_KEY);
      if (saved) {
        const p = JSON.parse(saved);
        if (p && p.id) {
          p.bankCode = 'MOMO';
          return p;
        }
      }
    } catch (e) {}

    const defaultProfile = {
      id: 'usr_' + Math.random().toString(36).substring(2, 9) + Date.now().toString(36),
      name: 'Bạn',
      phone: '',
      bankCode: 'MOMO',
      accountNo: '',
      accountName: '',
      colorIdx: 0
    };
    saveUserProfile(defaultProfile);
    return defaultProfile;
  }

  function saveUserProfile(profile) {
    try {
      localStorage.setItem(USER_PROFILE_KEY, JSON.stringify(profile));

      // Đồng thời cập nhật vào AuthManager nếu đang đăng nhập
      if (window.AuthManager && window.AuthManager.isLoggedIn()) {
        const authUser = window.AuthManager.getCurrentUser();
        if (authUser && authUser.id === profile.id) {
          window.AuthManager.updateUser(authUser.id, {
            name: profile.name,
            phone: profile.phone,
            bankCode: profile.bankCode,
            accountNo: profile.accountNo,
            accountName: profile.accountName
          });
        }
      }

      updateHeaderUserAvatar();
    } catch (e) {
      console.error('Lưu profile lỗi:', e);
    }
  }

  // Kiểm tra xem một người dùng có thuộc về chuyến đi (là Host hoặc Member chính thức) hay không
  function isUserInTrip(trip, profile) {
    if (!trip || !profile || !profile.id) return false;

    // 1. Trưởng nhóm tạo chuyến đi
    if (trip.hostId && trip.hostId === profile.id) return true;

    // 2. Thành viên chính thức trong danh sách members
    if (trip.members && Array.isArray(trip.members)) {
      return trip.members.some(m => {
        if (m.userId && m.userId === profile.id) return true;
        if (profile.phone && m.phone && m.phone.replace(/\D/g, '') === profile.phone.replace(/\D/g, '')) return true;
        return false;
      });
    }

    return false;
  }

  // Kiểm tra xem người dùng có phải là Host của chuyến đi không
  function isUserHostOfTrip(trip, profile) {
    if (!trip || !profile || !profile.id) return false;
    if (trip.hostId && trip.hostId === profile.id) return true;
    const firstMem = trip.members && trip.members[0];
    if (firstMem && firstMem.userId === profile.id) return true;
    return false;
  }

  // Lấy danh sách chuyến đi của người dùng hiện tại
  function getMyTrips() {
    const profile = getUserProfile();
    if (!profile || !profile.id) return [];

    // Người dùng thông thường: CHỈ hiển thị các chuyến đi mà mình ĐÃ THAM GIA hoặc TẠO
    if (profile.role !== 'admin') {
      return trips.filter(t => isUserInTrip(t, profile));
    }

    // Quản trị viên (Admin): Trả về chuyến đi do Admin tạo/tham gia
    return trips.filter(t => isUserInTrip(t, profile));
  }

  // Tự động chọn chuyến đi phù hợp cho tài khoản hiện tại
  function selectInitialTrip() {
    const profile = getUserProfile();
    if (!profile || !profile.id) {
      currentTrip = null;
      return;
    }

    const myTrips = getMyTrips();

    // Nếu người dùng chưa tham gia bất kỳ chuyến đi nào (tài khoản mới tạo)
    if (myTrips.length === 0) {
      currentTrip = null;
      localStorage.removeItem('tripsplit_current_room');
      return;
    }

    // Nếu có phòng đã lưu trước đó và phòng đó thuộc danh sách của người dùng này
    const lastRoom = localStorage.getItem('tripsplit_current_room');
    if (lastRoom) {
      const found = myTrips.find(t => t.code === lastRoom);
      if (found) {
        currentTrip = found;
        return;
      }
    }

    // Mặc định chọn chuyến đi đầu tiên trong myTrips của người dùng
    currentTrip = myTrips[0];
    localStorage.setItem('tripsplit_current_room', currentTrip.code);
  }

  function updateHeaderUserAvatar() {
    const profile = getUserProfile();
    const avatarEl = document.getElementById('header-user-avatar');
    if (avatarEl) {
      if (profile.name && profile.name.trim() && profile.name.trim() !== 'Bạn') {
        avatarEl.textContent = getInitials(profile.name);
      } else {
        avatarEl.textContent = '👤';
      }
    }

    // Nút Quản trị viên trên Header: Chỉ hiển thị khi tài khoản đăng nhập là Admin
    const adminHeaderBtn = document.getElementById('btn-header-admin-users');
    if (adminHeaderBtn) {
      const isAdmin = window.AuthManager && window.AuthManager.isAdmin();
      adminHeaderBtn.style.display = isAdmin ? 'inline-flex' : 'none';
    }
  }

  function populateProfileBankDropdown() {
    const select = document.getElementById('profile-bank-select');
    if (select) select.value = 'MOMO';
  }

  function openUserProfileModal() {
    populateProfileBankDropdown();
    const profile = getUserProfile();
    document.getElementById('profile-name-input').value = profile.name || '';
    document.getElementById('profile-phone-input').value = profile.phone || '';
    const momoPhone = profile.accountNo || profile.phone || '';
    document.getElementById('profile-acc-input').value = momoPhone;
    document.getElementById('profile-acc-name').value = profile.accountName || '';
    const profileMomoLinkEl = document.getElementById('profile-momo-link');
    if (profileMomoLinkEl) profileMomoLinkEl.value = profile.momoLink || '';

    openModal('modal-user-profile');
  }

  function handleSaveUserProfile(e) {
    if (e) e.preventDefault();
    const profile = getUserProfile();
    const name = document.getElementById('profile-name-input').value.trim();
    const phone = document.getElementById('profile-phone-input').value.trim();
    const accountNo = document.getElementById('profile-acc-input').value.trim();
    const accountName = document.getElementById('profile-acc-name').value.trim().toUpperCase();
    const momoLink = document.getElementById('profile-momo-link') ? document.getElementById('profile-momo-link').value.trim() : '';
    const finalMomoLink = momoLink;

    if (!name) {
      showToast('Vui lòng nhập họ tên hoặc biệt danh!', 'warning');
      return;
    }

    profile.name = name;
    profile.phone = phone || accountNo;
    profile.bankCode = 'MOMO';
    profile.accountNo = accountNo || phone;
    profile.accountName = accountName;
    profile.momoLink = finalMomoLink;

    saveUserProfile(profile);
    closeModal('modal-user-profile');
    showToast('Đã lưu hồ sơ cá nhân thành công!', 'success');

    // Nếu đang trong chuyến đi, cập nhật profile vào thành viên của chuyến đi
    if (currentTrip && currentTrip.members) {
      const myMem = currentTrip.members.find(m => m.userId === profile.id || (m.name === 'Bạn' && (!m.userId || m.userId === profile.id)));
      if (myMem) {
        myMem.userId = profile.id;
        myMem.name = name;
        myMem.phone = phone;
        myMem.bankCode = 'MOMO';
        myMem.accountNo = accountNo;
        myMem.accountName = accountName;
        myMem.momoLink = finalMomoLink;
        saveTripsToStorage();
        renderAll();
      }
    }
  }

  function isCurrentUserHost() {
    if (!currentTrip) return false;
    const profile = getUserProfile();
    if (currentTrip.hostId && currentTrip.hostId === profile.id) return true;
    const firstMem = currentTrip.members && currentTrip.members[0];
    if (firstMem && (firstMem.userId === profile.id || (!currentTrip.hostId && firstMem.role === 'host'))) return true;
    if (firstMem && !currentTrip.hostId && (firstMem.name === profile.name || firstMem.name === 'Bạn')) return true;
    return false;
  }

  // ==========================================================================
  // AUTHENTICATION & LOGIN GATE CONTROLLER
  // ==========================================================================
  const LAST_LOGGED_USER_KEY = 'tripsplit_last_logged_user';

  function checkAuthGate() {
    const authScreen = document.getElementById('auth-screen');
    const appContainer = document.getElementById('app-container');

    if (!window.AuthManager) return true;

    if (!window.AuthManager.isLoggedIn()) {
      if (authScreen) authScreen.style.display = 'flex';
      if (appContainer) appContainer.style.display = 'none';
      setupAuthListeners();
      updateLastUserUI();
      return false;
    } else {
      if (authScreen) authScreen.style.display = 'none';
      if (appContainer) appContainer.style.display = 'block';
      return true;
    }
  }

  function updateLastUserUI() {
    const card = document.getElementById('auth-last-user-section');
    const divider = document.getElementById('auth-divider-line');
    const avatar = document.getElementById('last-user-avatar');
    const nameEl = document.getElementById('last-user-name');
    const metaEl = document.getElementById('last-user-meta');
    const btn = document.getElementById('btn-quick-login-last');
    if (!card || !btn) return;

    let lastUser = null;
    try {
      const raw = localStorage.getItem(LAST_LOGGED_USER_KEY);
      if (raw) lastUser = JSON.parse(raw);
    } catch (e) {}

    // Nếu chưa có ai đăng nhập trước đó trên máy này, mặc định hiển thị Quản trị viên
    if (!lastUser) {
      lastUser = {
        id: 'usr_admin',
        username: 'admin',
        name: 'Hương, T.Anh',
        role: 'admin'
      };
    }

    card.style.display = 'block';
    if (divider) divider.style.display = 'flex';

    const isAdmin = (lastUser.role === 'admin' || lastUser.username === 'admin');
    if (isAdmin) {
      btn.classList.add('admin');
      if (avatar) avatar.textContent = '👑';
      if (nameEl) nameEl.textContent = lastUser.name || 'Hương, T.Anh';
      if (metaEl) metaEl.textContent = 'Quản trị viên (@' + (lastUser.username || 'admin') + ')';
    } else {
      btn.classList.remove('admin');
      if (avatar) avatar.textContent = getInitials(lastUser.name || 'U');
      if (nameEl) nameEl.textContent = lastUser.name || lastUser.username;
      if (metaEl) metaEl.textContent = 'Thành viên (@' + lastUser.username + ')';
    }

    // Tự động điền username của tài khoản gần nhất vào form nhưng BẮT BUỘC nhập mật khẩu
    const uInput = document.getElementById('login-username');
    const pInput = document.getElementById('login-password');
    if (uInput && !uInput.value) {
      uInput.value = lastUser.username || 'admin';
    }
    if (pInput) {
      pInput.value = '';
    }

    btn.onclick = (e) => {
      e.preventDefault();
      if (uInput) uInput.value = lastUser.username || 'admin';
      if (pInput) {
        pInput.value = '';
        pInput.focus();
      }
      showToast(`Vui lòng nhập mật khẩu cho tài khoản @${lastUser.username || 'admin'}`, 'info');
    };
  }

  function setupAuthListeners() {
    const formLogin = document.getElementById('form-login');
    if (formLogin && !formLogin.dataset.bound) {
      formLogin.dataset.bound = 'true';
      formLogin.addEventListener('submit', handleLoginSubmit);
    }

    const btnTogglePwd = document.getElementById('btn-toggle-pwd');
    if (btnTogglePwd && !btnTogglePwd.dataset.bound) {
      btnTogglePwd.dataset.bound = 'true';
      btnTogglePwd.addEventListener('click', () => {
        const input = document.getElementById('login-password');
        if (!input) return;
        if (input.type === 'password') {
          input.type = 'text';
          btnTogglePwd.textContent = '🙈';
        } else {
          input.type = 'password';
          btnTogglePwd.textContent = '👁️';
        }
      });
    }

    updateLastUserUI();
  }

  async function handleLoginSubmit(e) {
    if (e && e.preventDefault) e.preventDefault();
    const userInput = document.getElementById('login-username');
    const passInput = document.getElementById('login-password');
    const errBox = document.getElementById('login-error-msg');

    const username = (userInput.value || '').trim();
    const password = (passInput.value || '').trim();

    if (!username || !password) {
      if (errBox) {
        errBox.textContent = 'Vui lòng nhập đầy đủ tên đăng nhập và mật khẩu!';
        errBox.style.display = 'block';
      }
      return;
    }

    // Đảm bảo đồng bộ tài khoản mới nhất từ máy chủ (được tạo từ máy tính) trước khi kiểm tra
    if (window.AuthManager && window.AuthManager.syncWithServer) {
      await window.AuthManager.syncWithServer();
    }

    let result = window.AuthManager.login(username, password);
    if (!result.success) {
      if (errBox) {
        errBox.textContent = result.message || 'Đăng nhập không thành công!';
        errBox.style.display = 'block';
      }
      return;
    }

    // Đăng nhập thành công!
    if (errBox) errBox.style.display = 'none';
    passInput.value = '';

    await onLoginSuccess(result.user);
  }

  async function onLoginSuccess(user) {
    // Lưu lại user đăng nhập gần nhất vào localStorage (KHÔNG lưu mật khẩu)
    try {
      localStorage.setItem(LAST_LOGGED_USER_KEY, JSON.stringify({
        id: user.id,
        username: user.username,
        name: user.name,
        role: user.role
      }));
    } catch (e) {}

    checkAuthGate();
    try {
      populateProfileBankDropdown();
      updateHeaderUserAvatar();
      await fetchServerInfo();
      await loadLocalTrips();
      if (pendingJoinRoomCode) {
        await processJoinRoomParam(pendingJoinRoomCode);
      } else {
        await setupUrlParams();
      }
      populateBankDropdown();
      setupEventListeners();
      setupPwaServiceWorker();
      renderAll();
    } catch (err) {
      console.warn('Lỗi phụ khi hiển thị sau khi đăng nhập:', err);
      renderAll();
    }
    showToast(`Xin chào ${user.name}! Đăng nhập thành công.`, 'success');
  }

  function handleLogout() {
    if (!confirm('Bạn có chắc chắn muốn đăng xuất khỏi tài khoản trên thiết bị này?')) {
      return;
    }

    if (window.AuthManager) {
      window.AuthManager.logout();
    }

    // Xóa trạng thái chuyến đi đang mở để tránh lưu vết cho tài khoản tiếp theo
    localStorage.removeItem('tripsplit_current_room');
    currentTrip = null;

    closeModal('modal-user-profile');
    closeModal('modal-admin-users');
    closeModal('modal-change-password');
    closeModal('modal-trip-switcher');

    const authScreen = document.getElementById('auth-screen');
    const appContainer = document.getElementById('app-container');
    if (authScreen) authScreen.style.display = 'flex';
    if (appContainer) appContainer.style.display = 'none';

    renderAll();
    showToast('Đã đăng xuất tài khoản thành công!', 'info');
  }

  // ==========================================================================
  // INITIALIZATION
  // ==========================================================================
  async function init() {
    setupAuthListeners();

    // Lấy thông tin server mạng LAN (nếu đang chạy dev local trên máy tính)
    await fetchServerInfo();

    // Lưu lại mã phòng từ URL nếu có (ví dụ: ?room=TRIP5100)
    const urlParams = new URLSearchParams(window.location.search);
    const initialRoom = urlParams.get('room') || urlParams.get('trip');
    if (initialRoom) {
      pendingJoinRoomCode = initialRoom.trim().toUpperCase();
    }

    // Đồng bộ tài khoản từ máy chủ ngay khi mở trang
    if (window.AuthManager && window.AuthManager.syncWithServer) {
      await window.AuthManager.syncWithServer();
    }

    const isAuthed = checkAuthGate();
    if (!isAuthed) {
      // Người dùng chưa đăng nhập, dừng tại màn hình Login để bảo mật
      return;
    }

    populateProfileBankDropdown();
    updateHeaderUserAvatar();
    await loadLocalTrips();
    if (pendingJoinRoomCode) {
      await processJoinRoomParam(pendingJoinRoomCode);
    } else {
      await setupUrlParams();
    }
    populateBankDropdown();
    setupEventListeners();
    setupPwaServiceWorker();
    renderAll();

    // Đồng bộ định kỳ (mỗi 3.5 giây) và khi chuyển tab trình duyệt
    window.addEventListener('focus', () => {
      if (window.AuthManager && window.AuthManager.syncWithServer) window.AuthManager.syncWithServer();
      syncTripsWithServer();
    });
    setInterval(() => {
      if (window.AuthManager && window.AuthManager.syncWithServer) window.AuthManager.syncWithServer();
      syncTripsWithServer();
    }, 3500);
  }

  // Đồng bộ chuyến đi với máy chủ (giữa máy tính và điện thoại)
  async function syncTripsWithServer() {
    try {
      const res = await fetch('/api/trips');
      if (!res.ok) return;
      const serverTrips = await res.json();
      if (!Array.isArray(serverTrips)) return;

      if (serverTrips.length === 0 && trips && trips.length > 0) {
        // Máy tính có chuyến đi nhưng server chưa có -> đẩy lên server lưu
        await fetch('/api/trips', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(trips)
        });
      } else if (serverTrips.length > 0) {
        // Hợp nhất thông minh: Giữ lại chuyến đi trên máy nếu server bị thiếu (do Render ngủ đông/restart)
        const serverTripCodes = new Set(serverTrips.map(t => t.code || t.id));
        const localOnlyTrips = (trips || []).filter(t => t && (t.code || t.id) && t.status !== 'deleted' && !serverTripCodes.has(t.code || t.id));

        let hasLocalAdditions = false;
        let mergedTrips = [...serverTrips];
        if (localOnlyTrips.length > 0) {
          hasLocalAdditions = true;
          mergedTrips = mergedTrips.concat(localOnlyTrips);
        }

        trips = mergedTrips;
        localStorage.setItem('tripsplit_all_trips', JSON.stringify(trips));

        // Tự động đẩy lên lại server nếu máy khách có chuyến đi mà server bị thiếu
        if (hasLocalAdditions) {
          fetch('/api/trips', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(trips)
          }).catch(err => console.warn('Lỗi push re-sync trips:', err));
        }

        if (currentTrip) {
          const fresh = trips.find(t => t.id === currentTrip.id || t.code === currentTrip.code);
          const profile = getUserProfile();
          // Kiểm tra xem người dùng hiện tại còn là thành viên hoặc host của chuyến đi này không
          if (fresh && isUserInTrip(fresh, profile)) {
            currentTrip = fresh;
          } else {
            const wasTrip = currentTrip;
            currentTrip = null;
            localStorage.removeItem('tripsplit_current_room');
            closeModal('modal-member');
            closeModal('modal-add-expense');
            closeModal('modal-settle-qr');
            closeModal('modal-edit-expense');
            selectInitialTrip();
            if (wasTrip && profile && profile.id) {
              showToast(`Bạn không còn trong chuyến đi "${wasTrip.name}".`, 'warning');
            }
          }
        } else {
          selectInitialTrip();
        }
        renderAll();
      }
    } catch (e) {
      // Offline hoặc static host
    }
  }

  // Khởi tạo dữ liệu mẫu nếu máy chưa có chuyến đi nào
  async function loadLocalTrips() {
    let saved = null;
    try {
      saved = localStorage.getItem('tripsplit_all_trips');
      if (saved !== null) {
        trips = JSON.parse(saved);
        if (!Array.isArray(trips)) trips = [];
      }
    } catch (e) {
      trips = [];
    }

    // Luôn thử đồng bộ với máy chủ trước
    await syncTripsWithServer();

    // Chỉ tự động sinh dữ liệu mẫu khi người dùng MỚI MỞ APP LẦN ĐẦU (saved === null)
    // Nếu người dùng đã từng sử dụng và chủ động xóa hết trips, giữ nguyên danh sách trống []
    if (trips.length === 0 && saved === null) {
      trips = [generateSeedTrip()];
      saveTripsToStorage();
    }

    // Đảm bảo mọi chuyến đi đều có cấu trúc fund và pendingMembers, hostId
    trips.forEach(t => {
      const hasFundExp = t.expenses && t.expenses.some(e => e.payerId === 'group_fund');
      const hasContrib = t.fund && t.fund.contributions && t.fund.contributions.length > 0;
      if (!t.fund) {
        t.fund = {
          enabled: Boolean(hasFundExp || hasContrib),
          treasurerId: t.members[0] ? t.members[0].id : null,
          contributions: []
        };
      } else if (t.fund.enabled === undefined) {
        t.fund.enabled = Boolean(hasFundExp || hasContrib);
      }

      if (!t.pendingMembers) t.pendingMembers = [];
      if (!t.hostId && t.members && t.members[0]) {
        t.hostId = t.members[0].userId || t.members[0].id;
        if (!t.members[0].role) t.members[0].role = 'host';
      }
    });

    // Chọn chuyến đi thuộc về tài khoản người dùng hiện tại (nếu chưa tham gia nhóm nào thì là null)
    selectInitialTrip();

    if (currentTrip && window.RealtimeSync) {
      window.RealtimeSync.joinRoom(currentTrip.code, (data) => {
        // Callback khi có cập nhật thời gian thực
        if (data && data.id === currentTrip.id) {
          currentTrip = data;
          saveTripsToStorage(false);
          renderAll();
          showToast('Dữ liệu chuyến đi vừa được đồng bộ realtime!', 'info');
        }
      });
    }
  }

  function generateSeedTrip() {
    const mem1 = { id: 'm_1', userId: 'usr_admin', name: 'Hương, T.Anh', phone: '0900000000', bankCode: 'MOMO', accountNo: '0900000000', accountName: 'HUONG VA TUAN ANH', role: 'host', colorIdx: 0 };
    const mem2 = { id: 'm_2', userId: 'usr_son', name: 'Sơn', phone: '0787574001', bankCode: 'MOMO', accountNo: '0787574001', accountName: 'NGUYEN VAN SON', role: 'member', colorIdx: 1 };
    const mem3 = { id: 'm_3', userId: 'usr_tan', name: 'Tấn', phone: '0933444555', bankCode: 'MOMO', accountNo: '0933444555', accountName: 'TRAN TAN', role: 'member', colorIdx: 2 };

    const expenses = [
      {
        id: 'exp_1',
        title: 'Đi nhậu',
        amount: 870000,
        category: 'food',
        payerId: 'm_2',
        splitType: 'shares',
        splits: [
          { memberId: 'm_1', isIncluded: true, shares: 2, amount: 435000 },
          { memberId: 'm_2', isIncluded: true, shares: 1, amount: 217500 },
          { memberId: 'm_3', isIncluded: true, shares: 1, amount: 217500 }
        ],
        date: '2026-09-07T08:00:00.000Z',
        receipt: null
      },
      {
        id: 'exp_2',
        title: 'Khách sạn',
        amount: 800000,
        category: 'hotel',
        payerId: 'm_3',
        splitType: 'shares',
        splits: [
          { memberId: 'm_1', isIncluded: true, shares: 2, amount: 400000 },
          { memberId: 'm_2', isIncluded: true, shares: 1, amount: 200000 },
          { memberId: 'm_3', isIncluded: true, shares: 1, amount: 200000 }
        ],
        date: '2026-09-07T09:00:00.000Z',
        receipt: null
      },
      {
        id: 'exp_3',
        title: 'Cf bên vũng tàu',
        amount: 267000,
        category: 'drink',
        payerId: 'm_1',
        splitType: 'shares',
        splits: [
          { memberId: 'm_1', isIncluded: true, shares: 2, amount: 133500 },
          { memberId: 'm_2', isIncluded: true, shares: 1, amount: 66750 },
          { memberId: 'm_3', isIncluded: true, shares: 1, amount: 66750 }
        ],
        date: '2026-09-07T10:00:00.000Z',
        receipt: null
      },
      {
        id: 'exp_4',
        title: 'Vòng tròn K',
        amount: 160000,
        category: 'shopping',
        payerId: 'm_1',
        splitType: 'shares',
        splits: [
          { memberId: 'm_1', isIncluded: true, shares: 2, amount: 80000 },
          { memberId: 'm_2', isIncluded: true, shares: 1, amount: 40000 },
          { memberId: 'm_3', isIncluded: true, shares: 1, amount: 40000 }
        ],
        date: '2026-09-07T11:00:00.000Z',
        receipt: null
      },
      {
        id: 'exp_5',
        title: 'Bánh canh',
        amount: 260000,
        category: 'food',
        payerId: 'm_1',
        splitType: 'shares',
        splits: [
          { memberId: 'm_1', isIncluded: true, shares: 2, amount: 130000 },
          { memberId: 'm_2', isIncluded: true, shares: 1, amount: 65000 },
          { memberId: 'm_3', isIncluded: true, shares: 1, amount: 65000 }
        ],
        date: '2026-09-07T12:00:00.000Z',
        receipt: null
      },
      {
        id: 'exp_6',
        title: 'Hải sản',
        amount: 350000,
        category: 'food',
        payerId: 'm_1',
        splitType: 'shares',
        splits: [
          { memberId: 'm_1', isIncluded: true, shares: 2, amount: 233333 },
          { memberId: 'm_2', isIncluded: false, shares: 1, amount: 0 },
          { memberId: 'm_3', isIncluded: true, shares: 1, amount: 116667 }
        ],
        date: '2026-09-07T13:00:00.000Z',
        receipt: null
      },
      {
        id: 'exp_7',
        title: 'Nước chấm, nước dừa, cơm ...',
        amount: 260000,
        category: 'food',
        payerId: 'm_1',
        splitType: 'shares',
        splits: [
          { memberId: 'm_1', isIncluded: true, shares: 2, amount: 173333 },
          { memberId: 'm_2', isIncluded: false, shares: 1, amount: 0 },
          { memberId: 'm_3', isIncluded: true, shares: 1, amount: 86667 }
        ],
        date: '2026-09-07T14:00:00.000Z',
        receipt: null
      },
      {
        id: 'exp_8',
        title: 'Cá viên',
        amount: 200000,
        category: 'food',
        payerId: 'm_3',
        splitType: 'shares',
        splits: [
          { memberId: 'm_1', isIncluded: true, shares: 2, amount: 100000 },
          { memberId: 'm_2', isIncluded: true, shares: 1, amount: 50000 },
          { memberId: 'm_3', isIncluded: true, shares: 1, amount: 50000 }
        ],
        date: '2026-09-07T15:00:00.000Z',
        receipt: null
      },
      {
        id: 'exp_9',
        title: 'Cafe bên',
        amount: 110000,
        category: 'drink',
        payerId: 'm_1',
        splitType: 'exact',
        splits: [
          { memberId: 'm_1', isIncluded: true, shares: 2, amount: 73334 },
          { memberId: 'm_2', isIncluded: false, shares: 1, amount: 0 },
          { memberId: 'm_3', isIncluded: true, shares: 1, amount: 36666 }
        ],
        date: '2026-09-07T16:00:00.000Z',
        receipt: null
      },
      {
        id: 'exp_10',
        title: 'Phà',
        amount: 430000,
        category: 'transport',
        payerId: 'm_1',
        splitType: 'exact',
        splits: [
          { memberId: 'm_1', isIncluded: true, shares: 1, amount: 190000 },
          { memberId: 'm_2', isIncluded: true, shares: 1, amount: 120000 },
          { memberId: 'm_3', isIncluded: true, shares: 1, amount: 120000 }
        ],
        date: '2026-09-07T17:00:00.000Z',
        receipt: null
      }
    ];

    return {
      id: 'trip_vungtau2026',
      code: 'VUNGTAU26',
      name: 'Chuyến Đi Vũng Tàu',
      hostId: 'usr_admin',
      members: [mem1, mem2, mem3],
      pendingMembers: [],
      expenses: expenses,
      settlements: [],
      fund: {
        enabled: false,
        treasurerId: null,
        contributions: []
      },
      createdAt: '2026-09-07T07:00:00.000Z'
    };
  }

  async function setupUrlParams() {
    const params = new URLSearchParams(window.location.search);
    const roomFromUrl = params.get('room') || params.get('trip');
    if (roomFromUrl) {
      const code = roomFromUrl.trim().toUpperCase();
      await processJoinRoomParam(code);
    }
  }

  async function processJoinRoomParam(code) {
    if (!code) return;
    code = code.trim().toUpperCase();

    // 1. Đồng bộ dữ liệu mới nhất từ máy chủ
    await syncTripsWithServer();

    const profile = getUserProfile();
    const found = trips.find(t => t.code === code);

    // Xóa tham số ?room= khỏi thanh địa chỉ để tránh kích hoạt lại khi F5
    try {
      const cleanUrl = window.location.pathname + (window.location.hash || '');
      window.history.replaceState({}, document.title, cleanUrl);
    } catch (e) {}

    pendingJoinRoomCode = null;

    if (!found) {
      showToast(`Không tìm thấy chuyến đi #${code} trên máy chủ. Vui lòng kiểm tra lại mã phòng!`, 'warning');
      return;
    }

    // Đã có chuyến đi trong hệ thống
    const isMember = found.members && found.members.some(m => (m.userId && m.userId === profile.id) || (profile.phone && m.phone === profile.phone));
    const isHost = (found.hostId && found.hostId === profile.id);

    if (isMember || isHost) {
      currentTrip = found;
      localStorage.setItem('tripsplit_current_room', currentTrip.code);
      renderAll();
      showToast(`Đã vào chuyến đi "${found.name}" (#${code})!`, 'success');
      return;
    }

    // Kiểm tra xem đã gửi yêu cầu và đang chờ duyệt chưa
    const existingReq = found.pendingMembers && found.pendingMembers.find(r => r.userId === profile.id);
    if (existingReq) {
      openWaitingApprovalModal(found, existingReq);
      return;
    }

    // Chưa là member: gọi handleJoinRoomWithCode để gửi yêu cầu vào pendingMembers
    await handleJoinRoomWithCode(code);
  }

  function saveTripsToStorage(broadcast = true) {
    try {
      localStorage.setItem('tripsplit_all_trips', JSON.stringify(trips));
      if (currentTrip) {
        localStorage.setItem('tripsplit_current_room', currentTrip.code);
        if (broadcast && window.RealtimeSync) {
          window.RealtimeSync.broadcastData(currentTrip);
        }
      } else {
        localStorage.removeItem('tripsplit_current_room');
      }

      // Đẩy lên máy chủ để đồng bộ đa thiết bị (máy tính <-> điện thoại)
      fetch('/api/trips', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(trips)
      }).catch(err => console.warn('Lỗi push trips lên server:', err));
    } catch (e) {
      console.error('Lưu storage lỗi:', e);
    }
  }

  function populateBankDropdown() {
    const select = document.getElementById('member-bank-select');
    if (select) select.value = 'MOMO';
  }

  // ==========================================================================
  // RENDERING CONTROLLERS
  // ==========================================================================
  function renderAll() {
    const viewNoTrips = document.getElementById('view-no-trips');
    updateHeaderUserAvatar();

    if (!currentTrip || trips.length === 0) {
      if (viewNoTrips) viewNoTrips.style.display = 'block';
      document.querySelectorAll('.tab-view').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.bottom-nav .nav-item').forEach(n => n.classList.remove('active'));
      const headerTitle = document.getElementById('header-trip-name');
      if (headerTitle) headerTitle.textContent = 'TripSplit';
      const bannerApprovals = document.getElementById('banner-pending-approvals');
      if (bannerApprovals) bannerApprovals.style.display = 'none';
      return;
    }

    if (viewNoTrips) viewNoTrips.style.display = 'none';
    if (!activeTab) activeTab = 'tab-overview';
    const activeTabEl = document.getElementById(activeTab);
    if (activeTabEl) activeTabEl.classList.add('active');
    const activeNavBtn = document.querySelector(`.bottom-nav [data-tab="${activeTab}"]`);
    if (activeNavBtn) activeNavBtn.classList.add('active');

    // FAB (+) removed per user request

    // 1. Header & Hero Info
    document.getElementById('header-trip-name').textContent = currentTrip.name;
    document.getElementById('hero-display-name').textContent = currentTrip.name;
    document.getElementById('hero-room-code').textContent = currentTrip.code;
    document.getElementById('share-room-code-display').textContent = currentTrip.code;

    // Pending Approvals Banner (Cho Trưởng nhóm)
    const bannerApprovals = document.getElementById('banner-pending-approvals');
    if (bannerApprovals) {
      const isHost = isCurrentUserHost();
      const pendingList = currentTrip.pendingMembers || [];
      if (isHost && pendingList.length > 0) {
        bannerApprovals.style.display = 'flex';
        const countEl = document.getElementById('pending-count-num');
        if (countEl) countEl.textContent = pendingList.length;
      } else {
        bannerApprovals.style.display = 'none';
      }
    }

    // 2. Debt & Summary calculations
    const summary = window.DebtEngine.getTripSummary(
      currentTrip,
      currentTrip.members,
      currentTrip.expenses,
      currentTrip.settlements
    );

    document.getElementById('hero-total-val').textContent = Number(summary.totalSpent).toLocaleString('vi-VN');
    document.getElementById('hero-avg-val').textContent = `${Number(summary.avgPerPerson).toLocaleString('vi-VN')} đ`;
    document.getElementById('hero-count-val').textContent = `${currentTrip.expenses.length} khoản`;

    // Render Quỹ Nhóm (Thủ quỹ)
    renderFund(summary);

    // 3. Tab Views
    renderRecentExpenses(summary);
    renderExpenses(summary);
    renderMembers(summary);
    renderSettlement(summary);
    renderAnalytics(summary);
  }

  function renderRecentExpenses(summary) {
    const container = document.getElementById('recent-expenses-preview');
    const seeAllBtn = document.getElementById('btn-see-all-expenses');
    const gotoBtn = document.getElementById('btn-goto-expenses-tab');
    if (!container) return;

    const expenses = currentTrip.expenses || [];
    if (seeAllBtn) {
      seeAllBtn.textContent = `Xem tất cả (${expenses.length}) ➔`;
    }

    if (expenses.length === 0) {
      container.innerHTML = `
        <div style="text-align: center; color: var(--text-muted); font-size: 0.85rem; padding: 18px 10px;">
          Chưa có khoản chi nào. Bấm nút <strong>+ Thêm chi</strong> để bắt đầu!
        </div>
      `;
      if (gotoBtn) gotoBtn.style.display = 'none';
      return;
    }

    if (gotoBtn) gotoBtn.style.display = 'block';

    const memberMap = {};
    currentTrip.members.forEach(m => { memberMap[m.id] = m; });

    // Lấy tối đa 3 khoản chi mới nhất
    const sorted = [...expenses].sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0)).slice(0, 3);

    container.innerHTML = sorted.map(exp => {
      const isFund = exp.payerId === 'group_fund';
      const payerName = isFund ? '🏦 Quỹ Nhóm' : (memberMap[exp.payerId] ? memberMap[exp.payerId].name : 'Người khác');
      const icon = CATEGORY_ICONS[exp.category] || '💡';
      const dateStr = exp.date ? formatRelativeDate(new Date(exp.date)) : '';

      return `
        <div class="recent-expense-item" data-expense-id="${exp.id}" style="display: flex; align-items: center; justify-content: space-between; padding: 10px 12px; background: rgba(255,255,255,0.03); border: 1px solid var(--border-glass); border-radius: var(--radius-md); cursor: pointer; transition: all 0.2s ease;">
          <div style="display: flex; align-items: center; gap: 10px;">
            <div style="width: 36px; height: 36px; border-radius: var(--radius-md); background: rgba(16,185,129,0.12); display: flex; align-items: center; justify-content: center; font-size: 1.1rem;">${icon}</div>
            <div>
              <div style="font-weight: 700; color: #fff; font-size: 0.88rem;">${escapeHtml(exp.title)}</div>
              <div style="font-size: 0.72rem; color: var(--text-muted); margin-top: 2px;">
                <span ${isFund ? 'style="color: #f59e0b; font-weight: 700;"' : ''}>${escapeHtml(payerName)}</span> • ${dateStr}
              </div>
            </div>
          </div>
          <div style="font-weight: 700; color: #34d399; font-size: 0.9rem;">
            ${Number(exp.amount).toLocaleString('vi-VN')} đ
          </div>
        </div>
      `;
    }).join('');

    container.querySelectorAll('.recent-expense-item').forEach(item => {
      item.addEventListener('click', () => {
        const id = item.dataset.expenseId;
        openEditExpenseModal(id);
      });
    });
  }

  function renderExpenses(summary) {
    const container = document.getElementById('expense-list-container');
    const badge = document.getElementById('expense-count-badge');
    if (!container) return;

    const memberMap = {};
    currentTrip.members.forEach(m => { memberMap[m.id] = m; });

    const searchVal = (document.getElementById('expense-search-input')?.value || '').trim().toLowerCase();

    const filtered = currentTrip.expenses.filter(e => {
      if (activeCategoryFilter !== 'all' && e.category !== activeCategoryFilter) return false;
      if (searchVal) {
        const payer = (memberMap[e.payerId]?.name || '').toLowerCase();
        const title = (e.title || '').toLowerCase();
        if (!title.includes(searchVal) && !payer.includes(searchVal)) return false;
      }

      // Lọc theo ngày
      if (activeDateFilter !== 'all') {
        if (!e.date) return false;
        const expDate = new Date(e.date);
        const now = new Date();
        if (activeDateFilter === 'today') {
          if (expDate.toDateString() !== now.toDateString()) return false;
        } else if (activeDateFilter === 'yesterday') {
          const yesterday = new Date();
          yesterday.setDate(yesterday.getDate() - 1);
          if (expDate.toDateString() !== yesterday.toDateString()) return false;
        } else if (activeDateFilter === 'custom' && customDateFilter) {
          const ey = expDate.getFullYear();
          const em = String(expDate.getMonth() + 1).padStart(2, '0');
          const ed = String(expDate.getDate()).padStart(2, '0');
          if (`${ey}-${em}-${ed}` !== customDateFilter) return false;
        }
      }

      return true;
    });

    badge.textContent = filtered.length;

    if (filtered.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">🏖️</div>
          <div style="font-weight: 700; color: #fff; margin-bottom: 6px;">Chưa có khoản chi phù hợp</div>
          <div style="font-size: 0.85rem;">Bấm nút <strong>+ Thêm khoản chi</strong> để ghi nhận chi tiêu mới cho chuyến đi!</div>
        </div>
      `;
      return;
    }

    // Sắp xếp ngày mới nhất lên trên
    const sorted = [...filtered].sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

    container.innerHTML = sorted.map(exp => {
      const isFund = exp.payerId === 'group_fund';
      const payerName = isFund ? '🏦 Quỹ Nhóm' : (memberMap[exp.payerId] ? memberMap[exp.payerId].name : 'Người khác');
      const payerStyle = isFund ? 'style="color: #f59e0b; font-weight: 700;"' : '';
      const icon = CATEGORY_ICONS[exp.category] || '💡';
      const dateStr = exp.date ? formatRelativeDate(new Date(exp.date)) : '';
      const splitLabel = window.ExportHelper.getSplitTypeLabel(exp.splitType);

      return `
        <div class="expense-card" data-expense-id="${exp.id}">
          <div class="expense-category-icon">${icon}</div>
          <div class="expense-info">
            <div class="expense-title-row">
              <span class="expense-title">${escapeHtml(exp.title)}</span>
              <span class="expense-amount">${Number(exp.amount).toLocaleString('vi-VN')} đ</span>
            </div>
            <div class="expense-meta-row">
              <span class="payer-tag" ${payerStyle}>${escapeHtml(payerName)} chi</span>
              <span>•</span>
              <span class="split-tag">${splitLabel}</span>
              <span>•</span>
              <span>${dateStr}</span>
              ${exp.receipt ? `<span class="receipt-thumb-icon" title="Có ảnh hóa đơn">🧾</span>` : ''}
            </div>
          </div>
        </div>
      `;
    }).join('');

    // Click expense card để xem hoặc sửa
    container.querySelectorAll('.expense-card').forEach(card => {
      card.addEventListener('click', () => {
        const id = card.dataset.expenseId;
        openEditExpenseModal(id);
      });
    });
  }

  function renderMembers(summary) {
    const container = document.getElementById('members-list-container');
    const badge = document.getElementById('member-count-badge');
    if (!container) return;

    badge.textContent = currentTrip.members.length;

    // 1. Render Danh sách xin vào phòng (dành riêng cho Trưởng nhóm)
    const pendingSection = document.getElementById('pending-members-section');
    const pendingListContainer = document.getElementById('pending-members-list');
    const tabPendingCount = document.getElementById('tab-pending-count');
    const isHost = isCurrentUserHost();
    const pendingList = currentTrip.pendingMembers || [];

    if (pendingSection) {
      if (isHost && pendingList.length > 0) {
        pendingSection.style.display = 'block';
        if (tabPendingCount) tabPendingCount.textContent = pendingList.length;
        if (pendingListContainer) {
          pendingListContainer.innerHTML = pendingList.map(req => {
            const momoStr = req.phone || req.accountNo ? `MoMo: ${req.phone || req.accountNo}` : 'Chưa có SĐT MoMo';
            return `
              <div class="pending-request-card">
                <div class="request-user-info">
                  <div class="member-avatar" style="width: 38px; height: 38px; font-size: 0.85rem; background: linear-gradient(135deg, #f59e0b, #d97706);">${getInitials(req.name)}</div>
                  <div class="request-user-details">
                    <span class="request-user-name">${escapeHtml(req.name)}</span>
                    <span class="request-user-meta">${escapeHtml(momoStr)}</span>
                  </div>
                </div>
                <div class="request-actions">
                  <button class="btn-approve-req" data-approve-id="${req.requestId}">✓ Duyệt</button>
                  <button class="btn-reject-req" data-reject-id="${req.requestId}">✕</button>
                </div>
              </div>
            `;
          }).join('');

          pendingListContainer.querySelectorAll('[data-approve-id]').forEach(btn => {
            btn.addEventListener('click', () => handleApproveMember(btn.dataset.approveId));
          });
          pendingListContainer.querySelectorAll('[data-reject-id]').forEach(btn => {
            btn.addEventListener('click', () => handleRejectMember(btn.dataset.rejectId));
          });
        }
      } else {
        pendingSection.style.display = 'none';
      }
    }

    // 2. Render Danh sách thành viên chính thức
    const profile = getUserProfile();

    container.innerHTML = currentTrip.members.map((m, idx) => {
      const stat = summary.stats[m.id] || { totalPaid: 0, totalOwed: 0, netBalance: 0 };
      const initials = getInitials(m.name);
      const bg = AVATAR_COLORS[(m.colorIdx !== undefined ? m.colorIdx : idx) % AVATAR_COLORS.length];

      let balanceClass = 'zero';
      let balancePrefix = '';
      let statusText = 'Hòa vốn';

      if (stat.netBalance > 0) {
        balanceClass = 'positive';
        balancePrefix = '+';
        statusText = 'Được nhận lại';
      } else if (stat.netBalance < 0) {
        balanceClass = 'negative';
        balancePrefix = '-';
        statusText = 'Cần trả';
      }

      const momoPhone = m.phone || m.accountNo;
      const bankInfo = momoPhone 
        ? `<span style="color: #f472b6;">📱 Ví MoMo: ${escapeHtml(momoPhone)}</span>`
        : `<span style="color: var(--accent-amber);">⚠️ Chưa có SĐT Ví MoMo</span>`;

      // Role Chips
      const isHostMember = (currentTrip.hostId && (m.userId === currentTrip.hostId || m.id === currentTrip.hostId)) || m.role === 'host' || idx === 0;
      const isTreasurer = currentTrip.fund && currentTrip.fund.enabled && currentTrip.fund.treasurerId === m.id;
      const isMe = (m.userId && m.userId === profile.id) || (!m.userId && m.name === profile.name) || (m.name === 'Bạn');

      let roleChipsHtml = '';
      if (isHostMember) roleChipsHtml += `<span class="role-chip host">👑 Trưởng nhóm</span>`;
      if (isTreasurer) roleChipsHtml += `<span class="role-chip treasurer">🏦 Thủ quỹ</span>`;
      if (isMe) roleChipsHtml += `<span class="role-chip me">Bạn</span>`;
      if (!isHostMember && !isTreasurer && !isMe) roleChipsHtml += `<span class="role-chip member">Thành viên</span>`;

      // Chỉ Host mới có quyền xóa các thành viên khác
      const showDeleteBtn = isHost && !isHostMember;

      return `
        <div class="member-card" data-member-id="${m.id}">
          <div class="member-info-left" style="flex: 1; cursor: pointer;">
            <div class="member-avatar" style="background: ${bg};">${initials}</div>
            <div>
              <div class="member-name" style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                <span>${escapeHtml(m.name)}</span>
                ${roleChipsHtml}
              </div>
              <div class="member-bank-info">${bankInfo}</div>
            </div>
          </div>
          <div style="display: flex; align-items: center; gap: 10px;">
            <div class="member-balance" style="cursor: pointer;">
              <div class="amount ${balanceClass}">
                ${balancePrefix}${Math.abs(stat.netBalance).toLocaleString('vi-VN')} đ
              </div>
              <div class="status">${statusText}</div>
            </div>
            ${showDeleteBtn ? `
              <button class="btn-del-mem icon-btn" data-del-id="${m.id}" title="Xóa thành viên khỏi phòng" style="width: 32px; height: 32px; color: #f87171; border-color: rgba(239, 68, 68, 0.25); background: rgba(239, 68, 68, 0.08);">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
              </button>
            ` : ''}
          </div>
        </div>
      `;
    }).join('');

    container.querySelectorAll('.member-card').forEach(card => {
      // Click vào info để mở modal sửa
      const infoLeft = card.querySelector('.member-info-left');
      const balanceRight = card.querySelector('.member-balance');
      [infoLeft, balanceRight].forEach(el => {
        if (el) {
          el.addEventListener('click', () => {
            openEditMemberModal(card.dataset.memberId);
          });
        }
      });
    });

    // Sự kiện nút xóa thành viên trực tiếp
    container.querySelectorAll('.btn-del-mem').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        handleDeleteMember(btn.dataset.delId);
      });
    });
  }

  function renderSettlement(summary) {
    const container = document.getElementById('settlement-list-container');
    if (!container) return;

    const transactions = summary.transactions || [];

    if (transactions.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">🎉</div>
          <div style="font-weight: 700; color: #fff; margin-bottom: 6px;">Không có khoản nợ nào cần thanh toán!</div>
          <div style="font-size: 0.85rem;">Tất cả thành viên trong nhóm hiện đang hòa vốn hoặc đã hoàn tất quyết toán.</div>
        </div>
      `;
      return;
    }

    container.innerHTML = transactions.map((t, idx) => {
      const fromName = escapeHtml(t.from.name);
      const toName = escapeHtml(t.to.name);
      const hasBank = !!(t.to.bankCode && t.to.accountNo);
      const momoPhone = t.to.phone || t.to.accountNo || '';

      return `
        <div class="settlement-card">
          <div class="settlement-header">
            <div class="settle-flow">
              <span>${fromName}</span>
              <span class="settle-arrow">➔</span>
              <span>${toName}</span>
            </div>
            <div class="settle-amount">${Number(t.amount).toLocaleString('vi-VN')} đ</div>
          </div>

              <div style="font-size: 0.82rem; color: #fbcfe8; margin-bottom: 12px; display: flex; align-items: center; gap: 6px;">
                <span style="display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; background: #d82d8b; border-radius: 4px; color: #fff; font-size: 0.65rem; font-weight: 900;">M</span>
                <span>Ví MoMo thụ hưởng: <strong style="color: #fff; letter-spacing: 0.5px;">${momoPhone || 'Chưa cập nhật SĐT'}</strong> ${t.to.accountName ? `(${escapeHtml(t.to.accountName)})` : ''}</span>
              </div>

              <div class="settle-btn-group">
                <button class="open-momo-btn" data-tx-idx="${idx}">
                  <span style="display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; background: #fff; border-radius: 6px; color: #d82d8b; font-weight: 900; font-size: 0.72rem;">M</span>
                  <span>Chuyển Tiền Qua Ví MoMo</span>
                </button>
                <button class="qr-pay-btn" data-tx-idx="${idx}" style="color: #f472b6; border-color: rgba(216, 45, 139, 0.4); background: rgba(216, 45, 139, 0.1);">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="6" height="6" x="3" y="3" rx="1"/><rect width="6" height="6" x="15" y="3" rx="1"/><rect width="6" height="6" x="3" y="15" rx="1"/><path d="M14 14h2v2h-2z"/><path d="M18 14h3v3h-3z"/><path d="M14 18h3v3h-3z"/></svg>
                  <span>Mã QR MoMo</span>
                </button>
                <button class="mark-settled-btn" data-settle-idx="${idx}" title="Đánh dấu đã trả xong">
                  Đã trả
                </button>
              </div>
            </div>
          `;
        }).join('');

        // Sự kiện mở modal chuyển tiền qua Ví MoMo
        container.querySelectorAll('.open-momo-btn, .open-bank-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            const idx = parseInt(btn.dataset.txIdx, 10);
            openBankAppModal(transactions[idx]);
          });
        });

    // Sự kiện mở modal VietQR
    container.querySelectorAll('.qr-pay-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.txIdx, 10);
        openVietQrModal(transactions[idx]);
      });
    });

    // Đánh dấu đã trả
    container.querySelectorAll('.mark-settled-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.settleIdx, 10);
        confirmSettleTransaction(transactions[idx]);
      });
    });
  }

  function renderAnalytics(summary) {
    const barsContainer = document.getElementById('category-analytics-bars');
    if (!barsContainer) return;

    const total = summary.totalSpent || 1;
    const catTotals = summary.categoryTotals || {};

    const entries = Object.entries(catTotals).sort((a, b) => b[1] - a[1]);

    if (entries.length === 0) {
      barsContainer.innerHTML = '<div style="color: var(--text-muted); font-size: 0.85rem;">Chưa có dữ liệu chi tiêu để phân tích.</div>';
      return;
    }

    barsContainer.innerHTML = entries.map(([cat, amount]) => {
      const pct = Math.round((amount / total) * 100);
      const icon = CATEGORY_ICONS[cat] || '💡';
      const name = CATEGORY_NAMES[cat] || cat;

      return `
        <div class="category-bar-row">
          <div class="category-bar-header">
            <span>${icon} ${name}</span>
            <span style="font-weight: 700; color: #fff;">
              ${Number(amount).toLocaleString('vi-VN')} đ <span style="color: var(--text-muted); font-weight: 400;">(${pct}%)</span>
            </span>
          </div>
          <div class="category-progress-track">
            <div class="category-progress-fill" style="width: ${pct}%;"></div>
          </div>
        </div>
      `;
    }).join('');
  }

  function renderFund(summary) {
    if (!currentTrip) return;
    if (!currentTrip.fund) {
      currentTrip.fund = {
        enabled: false,
        treasurerId: currentTrip.members[0] ? currentTrip.members[0].id : null,
        contributions: []
      };
    }

    const fundCard = document.getElementById('fund-card');
    const quickFundLabel = document.getElementById('quick-fund-label');
    const isEnabled = Boolean(currentTrip.fund && currentTrip.fund.enabled);

    if (fundCard) {
      fundCard.style.display = isEnabled ? 'block' : 'none';
    }

    if (quickFundLabel) {
      quickFundLabel.textContent = isEnabled ? 'Quỹ nhóm' : '+ Quỹ nhóm';
    }

    if (!isEnabled) return;

    const fund = currentTrip.fund;
    const fundSummary = summary.fundSummary || { totalCollected: 0, totalSpent: 0, remaining: 0, treasurerId: null };

    const treasurer = currentTrip.members.find(m => m.id === fund.treasurerId) || currentTrip.members[0];
    const treasurerNameEl = document.getElementById('fund-treasurer-name');
    if (treasurerNameEl) {
      treasurerNameEl.textContent = treasurer ? treasurer.name : 'Chưa chọn';
    }

    const remainingEl = document.getElementById('fund-remaining-amount');
    const statusChip = document.getElementById('fund-status-chip');
    const progressBar = document.getElementById('fund-progress-bar');
    const collectedEl = document.getElementById('fund-total-collected');
    const spentEl = document.getElementById('fund-total-spent');

    const rem = fundSummary.remaining;
    if (remainingEl) {
      remainingEl.textContent = `${Number(rem).toLocaleString('vi-VN')} đ`;
      remainingEl.classList.toggle('empty', rem <= 0);
    }

    if (statusChip) {
      if (rem > 0) {
        statusChip.textContent = 'Quỹ đang hoạt động';
        statusChip.className = 'fund-status-chip';
      } else if (rem === 0 && fundSummary.totalCollected > 0) {
        statusChip.textContent = 'Đã hết quỹ (Chi tiền túi)';
        statusChip.className = 'fund-status-chip warning';
      } else if (rem < 0) {
        statusChip.textContent = 'Quỹ âm (Thủ quỹ bù)';
        statusChip.className = 'fund-status-chip warning';
      } else {
        statusChip.textContent = 'Chưa gom quỹ';
        statusChip.className = 'fund-status-chip';
      }
    }

    if (collectedEl) collectedEl.textContent = `${Number(fundSummary.totalCollected).toLocaleString('vi-VN')} đ`;
    if (spentEl) spentEl.textContent = `${Number(fundSummary.totalSpent).toLocaleString('vi-VN')} đ`;

    if (progressBar) {
      const pct = fundSummary.totalCollected > 0 
        ? Math.max(0, Math.min(100, Math.round((fundSummary.remaining / fundSummary.totalCollected) * 100)))
        : 0;
      progressBar.style.width = `${pct}%`;
    }
  }

  // ==========================================================================
  // MODALS & ACTIONS
  // ==========================================================================
  function openAddExpenseModal() {
    if (!currentTrip) {
      showToast('Vui lòng tạo hoặc tham gia một chuyến đi trước khi thêm chi tiêu!', 'warning');
      openTripSwitcherModal();
      return;
    }
    document.getElementById('expense-modal-title').textContent = 'Thêm khoản chi mới';
    document.getElementById('edit-expense-id').value = '';
    document.getElementById('expense-amount').value = '';
    document.getElementById('expense-title').value = '';
    tempReceiptData = null;
    document.getElementById('receipt-preview-thumb').style.display = 'none';

    const delBtn = document.getElementById('btn-delete-expense');
    if (delBtn) delBtn.style.display = 'none';

    // Populate Payer Select
    const payerSelect = document.getElementById('expense-payer');
    payerSelect.innerHTML = '';

    const summary = window.DebtEngine.getTripSummary(currentTrip, currentTrip.members, currentTrip.expenses, currentTrip.settlements);
    const remFund = summary.fundSummary ? summary.fundSummary.remaining : 0;

    // Tùy chọn 1: Quỹ nhóm (chỉ hiển thị nếu chuyến đi CÓ sử dụng Quỹ nhóm)
    if (currentTrip.fund && currentTrip.fund.enabled) {
      const fundOpt = document.createElement('option');
      fundOpt.value = 'group_fund';
      fundOpt.textContent = `🏦 Quỹ Nhóm (Thủ quỹ chi) [Số dư: ${Number(remFund).toLocaleString('vi-VN')} đ]`;
      payerSelect.appendChild(fundOpt);
    }

    // Tùy chọn thành viên
    currentTrip.members.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = `👤 ${m.name} (Tự trả tiền túi)`;
      payerSelect.appendChild(opt);
    });

    // Reset Category
    setCategory('food');
    // Reset Split Type
    setSplitType('equal');

    // Ngày chi tiêu mặc định hôm nay (giờ địa phương YYYY-MM-DD)
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const expDateInput = document.getElementById('expense-date');
    if (expDateInput) expDateInput.value = `${yyyy}-${mm}-${dd}`;

    openModal('modal-add-expense');
  }

  function openEditExpenseModal(expenseId) {
    const exp = currentTrip.expenses.find(e => e.id === expenseId);
    if (!exp) return;

    document.getElementById('expense-modal-title').textContent = 'Chỉnh sửa khoản chi';
    document.getElementById('edit-expense-id').value = exp.id;
    document.getElementById('expense-amount').value = exp.amount;
    document.getElementById('expense-title').value = exp.title;

    // Ngày chi tiêu của khoản chi
    const expDateInput = document.getElementById('expense-date');
    if (expDateInput) {
      if (exp.date) {
        try {
          const d = new Date(exp.date);
          const ey = d.getFullYear();
          const em = String(d.getMonth() + 1).padStart(2, '0');
          const ed = String(d.getDate()).padStart(2, '0');
          expDateInput.value = `${ey}-${em}-${ed}`;
        } catch (e) {
          expDateInput.value = new Date().toISOString().split('T')[0];
        }
      } else {
        expDateInput.value = new Date().toISOString().split('T')[0];
      }
    }

    const delBtn = document.getElementById('btn-delete-expense');
    if (delBtn) delBtn.style.display = 'block';

    // Populate Payer
    const payerSelect = document.getElementById('expense-payer');
    payerSelect.innerHTML = '';

    const summary = window.DebtEngine.getTripSummary(currentTrip, currentTrip.members, currentTrip.expenses, currentTrip.settlements);
    const remFund = summary.fundSummary ? summary.fundSummary.remaining : 0;

    const isFundEnabled = Boolean(currentTrip.fund && currentTrip.fund.enabled);
    if (isFundEnabled || exp.payerId === 'group_fund') {
      const fundOpt = document.createElement('option');
      fundOpt.value = 'group_fund';
      fundOpt.textContent = `🏦 Quỹ Nhóm (Thủ quỹ chi) [Số dư: ${Number(remFund).toLocaleString('vi-VN')} đ]`;
      if (exp.payerId === 'group_fund') fundOpt.selected = true;
      payerSelect.appendChild(fundOpt);
    }

    currentTrip.members.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = `👤 ${m.name} (Tự trả tiền túi)`;
      if (m.id === exp.payerId) opt.selected = true;
      payerSelect.appendChild(opt);
    });

    setCategory(exp.category || 'food');
    setSplitType(exp.splitType || 'equal', exp.splits);

    // Receipt
    if (exp.receipt) {
      tempReceiptData = exp.receipt;
      document.getElementById('receipt-preview-img').src = exp.receipt;
      document.getElementById('receipt-preview-thumb').style.display = 'block';
    } else {
      tempReceiptData = null;
      document.getElementById('receipt-preview-thumb').style.display = 'none';
    }

    openModal('modal-add-expense');
  }

  function setCategory(catKey) {
    selectedCategory = catKey;
    document.querySelectorAll('#category-selector .cat-item').forEach(item => {
      item.classList.toggle('active', item.dataset.val === catKey);
    });
  }

  function setSplitType(type, existingSplits = null) {
    if (type === 'custom') type = 'equal';
    selectedSplitType = type;
    document.querySelectorAll('#split-type-segments .segment-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.type === type);
    });
    renderSplitMembersList(existingSplits);
  }

  function renderSplitMembersList(existingSplits = null) {
    const container = document.getElementById('split-members-container');
    if (!container) return;

    const totalAmount = parseFloat(document.getElementById('expense-amount').value) || 0;

    const rowsHtml = currentTrip.members.map(m => {
      const exSplit = existingSplits ? existingSplits.find(s => s.memberId === m.id) : null;
      const isIncluded = exSplit ? (exSplit.isIncluded !== false) : true;
      const initialShares = exSplit ? (exSplit.shares || 1) : 1;
      const initialAmount = exSplit ? (exSplit.amount || 0) : 0;

      let extraControl = '';

      if (selectedSplitType === 'shares') {
        extraControl = `
          <div style="display: flex; align-items: center; gap: 6px;">
            <span style="font-size: 0.75rem; color: var(--text-muted);">Suất:</span>
            <input type="number" class="split-share-input form-input" data-mid="${m.id}" value="${initialShares}" min="0.5" step="0.5" style="width: 60px; padding: 4px 8px; text-align: center;">
          </div>
        `;
      } else if (selectedSplitType === 'exact') {
        const valAttr = initialAmount > 0 ? `value="${initialAmount}"` : '';
        extraControl = `
          <div style="display: flex; align-items: center; gap: 4px;">
            <input type="number" class="split-exact-input form-input" data-mid="${m.id}" ${valAttr} placeholder="0" min="0" step="1000" style="width: 120px; padding: 6px 8px; text-align: right; font-weight: 700; font-size: 0.9rem;">
            <span style="font-size: 0.75rem; color: var(--text-muted);">đ</span>
          </div>
        `;
      }

      return `
        <div class="split-member-row">
          <div class="split-member-left">
            <input type="checkbox" class="checkbox-custom split-member-check" data-mid="${m.id}" ${isIncluded ? 'checked' : ''}>
            <span style="font-size: 0.9rem; font-weight: 600;">${escapeHtml(m.name)}</span>
          </div>
          ${extraControl}
        </div>
      `;
    }).join('');

    let summaryHtml = '';
    if (selectedSplitType === 'exact') {
      summaryHtml = `
        <div id="exact-total-summary-row" style="display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; margin-top: 8px; background: rgba(59, 130, 246, 0.08); border: 1px solid rgba(59, 130, 246, 0.25); border-radius: var(--radius-md);">
          <span style="font-size: 0.82rem; color: var(--text-muted); display: flex; align-items: center; gap: 6px;">
            <span>⚡ Tự động tính tổng:</span>
          </span>
          <span id="exact-split-total-badge" style="font-size: 1rem; font-weight: 800; color: #60a5fa;">0 đ</span>
        </div>
      `;
    }

    container.innerHTML = rowsHtml + summaryHtml;

    // Gắn sự kiện tự động tính tổng khi ở tab "Số tiền"
    if (selectedSplitType === 'exact') {
      let hasUserEdited = Boolean(existingSplits && existingSplits.some(s => (s.amount || 0) > 0));

      const recalculateExactTotal = (isDirectEdit = false) => {
        if (isDirectEdit) hasUserEdited = true;
        let sum = 0;
        container.querySelectorAll('.split-member-row').forEach(row => {
          const chk = row.querySelector('.split-member-check');
          const input = row.querySelector('.split-exact-input');
          if (input) {
            const val = parseFloat(input.value) || 0;
            if (val > 0 && chk && !chk.checked) {
              chk.checked = true;
            }
            if (chk ? chk.checked : true) {
              sum += val;
            }
          }
        });

        // Tự động điền số tổng vào ô số tiền lớn
        const amountEl = document.getElementById('expense-amount');
        if (amountEl && (hasUserEdited || sum > 0)) {
          amountEl.value = sum > 0 ? sum : '';
        }

        // Cập nhật badge tổng cộng bên dưới
        const badge = document.getElementById('exact-split-total-badge');
        if (badge) {
          badge.textContent = Number(sum).toLocaleString('vi-VN') + ' đ';
        }
      };

      container.querySelectorAll('.split-exact-input').forEach(input => {
        input.addEventListener('input', () => recalculateExactTotal(true));
        input.addEventListener('change', () => recalculateExactTotal(true));
      });

      container.querySelectorAll('.split-member-check').forEach(chk => {
        chk.addEventListener('change', () => {
          const row = chk.closest('.split-member-row');
          const input = row ? row.querySelector('.split-exact-input') : null;
          if (!chk.checked && input) {
            input.dataset.prevVal = input.value;
            input.value = '';
          } else if (chk.checked && input && (!input.value || input.value === '0')) {
            if (input.dataset.prevVal) {
              input.value = input.dataset.prevVal;
            }
          }
          recalculateExactTotal(true);
        });
      });

      // Tính tổng ngay khi vừa mở
      recalculateExactTotal(false);
    }
  }

  function handleSaveExpense(e) {
    e.preventDefault();

    const amount = parseFloat(document.getElementById('expense-amount').value);
    const title = document.getElementById('expense-title').value.trim();
    const payerId = document.getElementById('expense-payer').value;
    const editId = document.getElementById('edit-expense-id').value;

    if (!amount || amount <= 0 || !title || !payerId) {
      showToast('Vui lòng nhập đầy đủ số tiền và nội dung!', 'warning');
      return;
    }

    // Thu thập dữ liệu chia
    const splits = [];
    document.querySelectorAll('.split-member-check').forEach(chk => {
      const mid = chk.dataset.mid;
      const isInc = chk.checked;
      const splitObj = { memberId: mid, isIncluded: isInc };

      if (selectedSplitType === 'shares') {
        const shareInput = document.querySelector(`.split-share-input[data-mid="${mid}"]`);
        splitObj.shares = shareInput ? parseFloat(shareInput.value) || 1 : 1;
      } else if (selectedSplitType === 'exact') {
        const exactInput = document.querySelector(`.split-exact-input[data-mid="${mid}"]`);
        splitObj.amount = exactInput ? parseFloat(exactInput.value) || 0 : 0;
      }

      splits.push(splitObj);
    });

    // Lấy ngày chi tiêu từ form
    const dateVal = document.getElementById('expense-date')?.value;
    let expenseIsoDate;
    if (dateVal) {
      const parts = dateVal.split('-');
      if (parts.length === 3) {
        const d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10), 12, 0, 0);
        expenseIsoDate = d.toISOString();
      } else {
        expenseIsoDate = new Date().toISOString();
      }
    } else {
      expenseIsoDate = new Date().toISOString();
    }

    if (editId) {
      const idx = currentTrip.expenses.findIndex(x => x.id === editId);
      if (idx !== -1) {
        currentTrip.expenses[idx] = {
          ...currentTrip.expenses[idx],
          title,
          amount,
          category: selectedCategory,
          payerId,
          splitType: selectedSplitType,
          splits,
          receipt: tempReceiptData,
          date: expenseIsoDate
        };
        showToast('Đã cập nhật khoản chi!', 'success');
      }
    } else {
      const newExp = {
        id: 'exp_' + Date.now(),
        title,
        amount,
        category: selectedCategory,
        payerId,
        splitType: selectedSplitType,
        splits,
        receipt: tempReceiptData,
        date: expenseIsoDate
      };
      currentTrip.expenses.push(newExp);
      showToast('Đã ghi nhận khoản chi mới!', 'success');
    }

    saveTripsToStorage();
    renderAll();
    closeModal('modal-add-expense');
  }

  // Quản lý thành viên
  function openAddMemberModal() {
    if (!currentTrip) {
      showToast('Vui lòng tạo hoặc tham gia một chuyến đi trước!', 'warning');
      openTripSwitcherModal();
      return;
    }
    document.getElementById('member-modal-title').textContent = 'Thêm thành viên mới';
    document.getElementById('edit-member-id').value = '';
    document.getElementById('member-name-input').value = '';
    document.getElementById('member-bank-select').value = '';
    document.getElementById('member-acc-input').value = '';
    document.getElementById('member-acc-name').value = '';
    const memLinkEl = document.getElementById('member-momo-link');
    if (memLinkEl) memLinkEl.value = '';

    const delBtn = document.getElementById('btn-delete-member');
    if (delBtn) delBtn.style.display = 'none';

    openModal('modal-member');
  }

  function openEditMemberModal(memberId) {
    if (!currentTrip) return;
    const mem = currentTrip.members.find(m => m.id === memberId);
    if (!mem) return;

    document.getElementById('member-modal-title').textContent = 'Chỉnh sửa thông tin thành viên';
    document.getElementById('edit-member-id').value = mem.id;
    document.getElementById('member-name-input').value = mem.name;
    const bankSelect = document.getElementById('member-bank-select');
    if (bankSelect) bankSelect.value = 'MOMO';
    document.getElementById('member-acc-input').value = mem.phone || mem.accountNo || '';
    document.getElementById('member-acc-name').value = mem.accountName || '';
    const memLinkEl = document.getElementById('member-momo-link');
    if (memLinkEl) memLinkEl.value = mem.momoLink || '';

    const delBtn = document.getElementById('btn-delete-member');
    if (delBtn) delBtn.style.display = 'block';

    openModal('modal-member');
  }

  function handleSaveMember(e) {
    e.preventDefault();
    const editId = document.getElementById('edit-member-id').value;
    const name = document.getElementById('member-name-input').value.trim();
    const accountNo = document.getElementById('member-acc-input').value.trim();
    const accountName = document.getElementById('member-acc-name').value.trim().toUpperCase();
    const momoLink = document.getElementById('member-momo-link') ? document.getElementById('member-momo-link').value.trim() : '';
    const finalMomoLink = momoLink;

    if (!name) return;

    if (editId) {
      const m = currentTrip.members.find(x => x.id === editId);
      if (m) {
        m.name = name;
        m.bankCode = 'MOMO';
        m.phone = accountNo || m.phone || '';
        m.accountNo = accountNo;
        m.accountName = accountName;
        m.momoLink = finalMomoLink;
        showToast('Đã cập nhật thông tin thành viên!', 'success');
      }
    } else {
      const newMem = {
        id: 'm_' + Date.now(),
        name,
        phone: accountNo,
        bankCode: 'MOMO',
        accountNo,
        accountName,
        momoLink: finalMomoLink,
        colorIdx: currentTrip.members.length % AVATAR_COLORS.length
      };
      currentTrip.members.push(newMem);
      showToast(`Đã thêm ${name} vào chuyến đi!`, 'success');
    }

    saveTripsToStorage();
    renderAll();
    closeModal('modal-member');
  }

  function handleDeleteMember(memberId) {
    if (!memberId) return;
    const mem = currentTrip.members.find(m => m.id === memberId);
    if (!mem) return;

    if (currentTrip.members.length <= 1) {
      showToast('Chuyến đi phải có ít nhất 1 thành viên!', 'warning');
      return;
    }

    const paidExpensesCount = currentTrip.expenses.filter(e => e.payerId === memberId).length;
    let confirmMsg = `Bạn có chắc chắn muốn xóa thành viên "${mem.name}" khỏi chuyến đi?`;
    if (paidExpensesCount > 0) {
      confirmMsg = `Thành viên "${mem.name}" đang là người trả tiền cho ${paidExpensesCount} khoản chi. Nếu xóa, người trả tiền của các khoản này sẽ được chuyển sang thành viên khác. Bạn có chắc muốn xóa không?`;
    }

    if (!confirm(confirmMsg)) return;

    // 1. Xóa khỏi danh sách thành viên
    currentTrip.members = currentTrip.members.filter(m => m.id !== memberId);

    // 2. Chuyển người trả tiền nếu khoản chi do người này trả
    const fallbackPayer = currentTrip.members[0];
    currentTrip.expenses.forEach(exp => {
      if (exp.payerId === memberId) {
        exp.payerId = fallbackPayer.id;
      }
      if (exp.splits) {
        exp.splits = exp.splits.filter(s => s.memberId !== memberId);
      }
    });

    // 3. Xóa các khoản thanh toán liên quan đến người này
    if (currentTrip.settlements) {
      currentTrip.settlements = currentTrip.settlements.filter(s => s.fromMemberId !== memberId && s.toMemberId !== memberId);
    }

    saveTripsToStorage();
    renderAll();
    closeModal('modal-member');
    showToast(`Đã xóa thành viên "${mem.name}" thành công!`, 'success');
  }

  function handleDeleteExpense(expenseId) {
    if (!expenseId) return;
    const exp = currentTrip.expenses.find(e => e.id === expenseId);
    if (!exp) return;

    if (!confirm(`Bạn có chắc muốn xóa khoản chi "${exp.title}" (${Number(exp.amount).toLocaleString('vi-VN')} đ)?`)) {
      return;
    }

    currentTrip.expenses = currentTrip.expenses.filter(e => e.id !== expenseId);
    saveTripsToStorage();
    renderAll();
    closeModal('modal-add-expense');
    showToast('Đã xóa khoản chi thành công!', 'success');
  }

  // VietQR / MoMo Payment Modal
  function openVietQrModal(transaction, customDesc = null) {
    currentQrTransaction = transaction;

    const receiver = transaction.to;
    const receiverPhone = (receiver.phone || receiver.accountNo || '').trim().replace(/\D/g, '');
    const amount = Number(transaction.amount) || 0;
    const receiverName = receiver.accountName || receiver.name;

    document.getElementById('qr-receiver-name').textContent = receiver.name + (receiver.accountName ? ` (${receiver.accountName})` : '');
    document.getElementById('qr-bank-name').textContent = 'Ví MoMo';
    document.getElementById('qr-acc-no').textContent = receiverPhone || 'Chưa cập nhật SĐT';
    document.getElementById('qr-amount').textContent = `${amount.toLocaleString('vi-VN')} VND`;

    const cleanTripCode = (currentTrip.code || 'TRIP').replace(/[^a-zA-Z0-9]/g, '');
    const cleanSenderName = removeVietnameseAccents(transaction.from ? transaction.from.name : '').replace(/\s+/g, '');
    const desc = customDesc || `${cleanTripCode} ${cleanSenderName} tra no`;
    document.getElementById('qr-desc').textContent = desc;

    // Sinh QR Code chuẩn MoMo chuyển tiền trực tiếp
    const qrImgTag = document.getElementById('qr-image-tag');
    if (receiverPhone) {
      const qrUrl = window.VietQRHelper.generateMoMoQrUrl(
        receiverPhone,
        amount,
        desc,
        receiverName,
        receiver.momoLink || null
      );
      if (qrUrl) {
        qrImgTag.src = qrUrl;
        qrImgTag.onerror = () => {
          const fallback = window.VietQRHelper.getMoMoFallbackQrUrl(receiverPhone, amount, desc, receiverName);
          if (fallback && qrImgTag.src !== fallback) qrImgTag.src = fallback;
        };
      }
    } else if (receiver.momoLink) {
      qrImgTag.src = window.VietQRHelper.generateMoMoQrUrl(null, amount, desc, receiverName, receiver.momoLink);
    } else {
      qrImgTag.src = `https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=${encodeURIComponent('Thanh toan MoMo ' + amount + ' VND cho ' + receiver.name)}`;
    }

    // Nút mở app MoMo từ modal QR
    const btnOpenBankFromQr = document.getElementById('btn-vietqr-open-bank');
    if (btnOpenBankFromQr) {
      btnOpenBankFromQr.onclick = () => {
        closeModal('modal-vietqr');
        openBankAppModal(transaction);
      };
    }

    // Nút tải ảnh QR từ modal QR
    const btnDownloadFromQr = document.getElementById('btn-vietqr-download');
    if (btnDownloadFromQr) {
      btnDownloadFromQr.onclick = () => {
        if (receiverPhone) {
          window.VietQRHelper.downloadQrImage(
            'MOMO',
            receiverPhone,
            transaction.amount,
            desc,
            receiverName,
            true
          );
          showToast('Đang tải ảnh QR MoMo về máy...', 'info');
        } else {
          showToast('Người nhận chưa cập nhật số điện thoại Ví MoMo!', 'warning');
        }
      };
    }

    openModal('modal-vietqr');
  }

  // Modal Chuyển Tiền Qua Ví MoMo
  let modalBankQrMode = 'momo';

  function openBankAppModal(transaction) {
    if (!transaction) return;
    currentQrTransaction = transaction;

    const receiver = transaction.to;
    const amount = Number(transaction.amount) || 0;
    const receiverPhone = (receiver.phone || receiver.accountNo || '').trim().replace(/\D/g, '');
    const receiverName = receiver.accountName || receiver.name;
    const cleanTripCode = (currentTrip.code || 'TRIP').replace(/[^a-zA-Z0-9]/g, '');
    const cleanSenderName = removeVietnameseAccents(transaction.from ? transaction.from.name : '').replace(/\s+/g, '');
    const desc = `${cleanTripCode} ${cleanSenderName} tra no`;

    // 1. Điền thông tin vào Card tóm tắt MoMo
    const amtEl = document.getElementById('bank-app-modal-amount');
    if (amtEl) amtEl.textContent = `${amount.toLocaleString('vi-VN')} đ`;

    const tipAmtEl = document.getElementById('momo-modal-tip-amount');
    if (tipAmtEl) tipAmtEl.textContent = `${amount.toLocaleString('vi-VN')} đ`;

    const recEl = document.getElementById('bank-app-modal-receiver');
    if (recEl) recEl.textContent = `${receiver.name} ${receiver.accountName ? `(${receiver.accountName})` : ''}`;

    const accEl = document.getElementById('bank-app-modal-acc');
    if (accEl) accEl.textContent = receiverPhone || 'Chưa có SĐT MoMo';

    const descEl = document.getElementById('bank-app-modal-desc');
    if (descEl) descEl.textContent = desc;

    // Sự kiện nút copy SĐT
    const btnCopyAcc = document.getElementById('btn-copy-bank-app-acc');
    if (btnCopyAcc) {
      btnCopyAcc.onclick = () => {
        if (receiverPhone) {
          copyToClipboard(receiverPhone, 'Đã sao chép SĐT Ví MoMo: ' + receiverPhone);
        } else {
          showToast('Người nhận chưa có SĐT MoMo!', 'warning');
        }
      };
    }

    // Sự kiện nút copy Số tiền
    const btnCopyAmount = document.getElementById('btn-copy-bank-app-amount');
    if (btnCopyAmount) {
      btnCopyAmount.onclick = () => {
        copyToClipboard(amount.toString(), 'Đã sao chép số tiền: ' + amount.toLocaleString('vi-VN') + ' đ');
      };
    }

    // Sự kiện nút copy Lời nhắn
    const btnCopyDesc = document.getElementById('btn-copy-bank-app-desc');
    if (btnCopyDesc) {
      btnCopyDesc.onclick = () => {
        copyToClipboard(desc, 'Đã sao chép lời nhắn chuyển tiền!');
      };
    }

    // 2. Nút Mở App MoMo duy nhất
    const btnOpenMoMoApp = document.getElementById('btn-momo-open-app');
    if (btnOpenMoMoApp) {
      btnOpenMoMoApp.onclick = () => {
        executeLaunchBankApp('MOMO', transaction, desc);
      };
    }

    // 3. Hiển thị mã QR MoMo trực tiếp (VietQR chuẩn MoMo - Tự nhận diện người nhận & số tiền khi quét)
    const qrImg = document.getElementById('bank-app-modal-qr-img');
    const hintEl = document.getElementById('momo-qr-type-hint');
    if (hintEl) {
      hintEl.textContent = `⚡ Mở App MoMo ("Quét mọi QR") để quét. Tự động nhận diện ${receiver.name} và số tiền ${amount.toLocaleString('vi-VN')} đ.`;
    }
    if (qrImg) {
      const qrUrl = window.VietQRHelper.generateMoMoQrUrl(
        receiverPhone,
        amount,
        desc,
        receiverName,
        receiver.momoLink || null
      );
      if (qrUrl) {
        qrImg.src = qrUrl;
        qrImg.onerror = () => {
          const fallback = window.VietQRHelper.getMoMoFallbackQrUrl(receiverPhone, amount, desc, receiverName);
          if (fallback && qrImg.src !== fallback) qrImg.src = fallback;
        };
      }
    }

    // 4. Nút tải ảnh QR & Xem QR lớn
    const btnDownload = document.getElementById('btn-bank-modal-download-qr');
    if (btnDownload) {
      btnDownload.onclick = () => {
        if (receiverPhone) {
          window.VietQRHelper.downloadQrImage(
            'MOMO',
            receiverPhone,
            amount,
            desc,
            receiverName,
            true
          );
          showToast('Đang tải ảnh QR MoMo về máy...', 'info');
        } else {
          showToast('Người nhận chưa cập nhật số điện thoại Ví MoMo!', 'warning');
        }
      };
    }

    const btnViewQr = document.getElementById('btn-bank-modal-view-qr');
    if (btnViewQr) {
      btnViewQr.onclick = () => {
        closeModal('modal-open-bank-app');
        openVietQrModal(transaction, desc);
      };
    }

    const btnConfirmPaid = document.getElementById('btn-bank-modal-confirm-paid');
    if (btnConfirmPaid) {
      btnConfirmPaid.onclick = () => {
        closeModal('modal-open-bank-app');
        confirmSettleTransaction(transaction);
      };
    }

    openModal('modal-open-bank-app');
  }

  function executeLaunchBankApp(bankCode, transaction, desc) {
    if (!transaction) return;
    const receiver = transaction.to;
    const amount = Number(transaction.amount) || 0;
    const receiverPhone = (receiver.phone || receiver.accountNo || '').trim().replace(/\D/g, '');
    const hasMomoLink = Boolean(receiver.momoLink && receiver.momoLink.trim());

    // Luôn copy sẵn số tiền vào clipboard để người dùng dán vào ô 0đ
    if (amount > 0) {
      copyToClipboard(amount.toString(), `Đã sao chép số tiền: ${amount.toLocaleString('vi-VN')} đ`);
    }

    if (hasMomoLink) {
      // Khi đã có Link nhận tiền cá nhân, MoMo mở thẳng vào người nhận (như trong app).
      showToast(`📋 ĐÃ COPY SỐ TIỀN: ${amount.toLocaleString('vi-VN')} đ\n👉 Đang mở MoMo tới ${receiver.name}. Bạn chỉ cần chạm vào ô "0đ" và bấm [DÁN] là xong ngay!`, 'success');
    } else {
      // Nếu chưa có link nhận tiền cá nhân, copy SĐT và nhắc quét QR
      if (receiverPhone) {
        showToast(`📋 ĐÃ COPY SỐ TIỀN: ${amount.toLocaleString('vi-VN')} đ & SĐT: ${receiverPhone}\n👉 MoMo đang mở. Bạn cũng có thể dùng MoMo quét mã QR trên màn hình để tự động điền sẵn cả người nhận lẫn số tiền!`, 'success');
      } else {
        showToast('Người nhận chưa có thông tin MoMo!', 'warning');
        return;
      }
    }

    // Mở MoMo
    window.VietQRHelper.openMoMoApp(receiverPhone, amount, desc, receiver.momoLink || null);

    const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    if (!isMobile) {
      setTimeout(() => {
        showToast('💡 Bạn cũng có thể dùng App MoMo ("Quét mọi QR") để quét mã QR trên màn hình!', 'info');
      }, 1500);
    }
  }

  // ==========================================================================
  // GROUP FUND MODAL CONTROLLER
  // ==========================================================================
  function openGroupFundModal() {
    if (!currentTrip) {
      showToast('Vui lòng tạo hoặc tham gia chuyến đi trước!', 'warning');
      openTripSwitcherModal();
      return;
    }

    if (!currentTrip.fund) {
      currentTrip.fund = {
        enabled: false,
        treasurerId: currentTrip.members[0] ? currentTrip.members[0].id : null,
        contributions: []
      };
    }

    const isEnabled = Boolean(currentTrip.fund.enabled);
    const toggleSwitch = document.getElementById('fund-enable-switch');
    const badge = document.getElementById('fund-toggle-status-badge');
    const body = document.getElementById('fund-modal-body');
    const disabledHint = document.getElementById('fund-modal-disabled-hint');

    if (toggleSwitch) toggleSwitch.checked = isEnabled;
    if (badge) {
      badge.textContent = isEnabled ? 'Đang bật' : 'Đang tắt';
      badge.classList.toggle('active', isEnabled);
    }
    if (body) body.style.display = isEnabled ? 'block' : 'none';
    if (disabledHint) disabledHint.style.display = isEnabled ? 'none' : 'block';

    const treasurerSelect = document.getElementById('fund-treasurer-select');
    treasurerSelect.innerHTML = '';
    currentTrip.members.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = `${m.name} ${m.bankCode ? `(${m.bankCode})` : '(Chưa có STK)'}`;
      if (m.id === currentTrip.fund.treasurerId) opt.selected = true;
      treasurerSelect.appendChild(opt);
    });

    updateTreasurerBankHint();

    const contributorSelect = document.getElementById('fund-contributor-select');
    contributorSelect.innerHTML = '';
    currentTrip.members.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.name;
      contributorSelect.appendChild(opt);
    });

    renderFundContributionsList();
    openModal('modal-group-fund');
  }

  function updateTreasurerBankHint() {
    const hintEl = document.getElementById('fund-treasurer-bank-hint');
    if (!hintEl) return;
    const treasurer = currentTrip.members.find(m => m.id === currentTrip.fund.treasurerId);
    const momoPhone = treasurer ? (treasurer.phone || treasurer.accountNo) : null;
    if (treasurer && momoPhone) {
      hintEl.textContent = `📱 Ví MoMo nhận quỹ: ${momoPhone} (${treasurer.accountName || treasurer.name})`;
      hintEl.style.color = '#10b981';
    } else {
      hintEl.textContent = `⚠️ Thủ quỹ chưa cập nhật SĐT Ví MoMo nhận tiền. Hãy vào tab Thành viên để điền SĐT MoMo cho Thủ quỹ.`;
      hintEl.style.color = '#f59e0b';
    }
  }

  function renderFundContributionsList() {
    const listEl = document.getElementById('fund-contributions-list');
    const badgeEl = document.getElementById('fund-contrib-count');
    if (!listEl) return;

    const contribs = (currentTrip.fund && currentTrip.fund.contributions) ? currentTrip.fund.contributions : [];
    if (badgeEl) badgeEl.textContent = contribs.length;

    if (contribs.length === 0) {
      listEl.innerHTML = '<div style="font-size: 0.8rem; color: var(--text-muted); padding: 8px 0;">Chưa có thành viên nào nộp tiền vào quỹ.</div>';
      return;
    }

    const memberMap = {};
    currentTrip.members.forEach(m => { memberMap[m.id] = m; });

    const sorted = [...contribs].sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

    listEl.innerHTML = sorted.map(c => {
      const mem = memberMap[c.memberId] || { name: 'Thành viên' };
      const dateStr = c.date ? new Date(c.date).toLocaleDateString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }) : '';

      return `
        <div style="background: rgba(255,255,255,0.03); border: 1px solid var(--border-glass); border-radius: var(--radius-md); padding: 8px 12px; display: flex; justify-content: space-between; align-items: center;">
          <div>
            <div style="font-weight: 700; color: #fff; font-size: 0.9rem;">${escapeHtml(mem.name)}</div>
            <div style="font-size: 0.72rem; color: var(--text-muted);">${dateStr}</div>
          </div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-weight: 800; color: #10b981; font-size: 0.95rem;">+${Number(c.amount).toLocaleString('vi-VN')} đ</span>
            <button class="btn-del-contrib icon-btn" data-cid="${c.id}" title="Xóa khoản nộp" style="width: 26px; height: 26px; color: #f87171; border-color: rgba(239, 68, 68, 0.2);">
              &times;
            </button>
          </div>
        </div>
      `;
    }).join('');

    listEl.querySelectorAll('.btn-del-contrib').forEach(btn => {
      btn.addEventListener('click', () => {
        handleDeleteContribution(btn.dataset.cid);
      });
    });
  }

  function handleQrContributeFund() {
    const contributorId = document.getElementById('fund-contributor-select').value;
    const amount = parseFloat(document.getElementById('fund-contribute-amount').value) || 0;

    if (amount <= 0) {
      showToast('Vui lòng nhập số tiền nộp hợp lệ!', 'warning');
      return;
    }

    const contributor = currentTrip.members.find(m => m.id === contributorId);
    const treasurer = currentTrip.members.find(m => m.id === currentTrip.fund.treasurerId);

    if (!treasurer) {
      showToast('Chưa chọn Thủ quỹ cho chuyến đi!', 'warning');
      return;
    }

    const cleanTripCode = (currentTrip.code || 'TRIP').replace(/[^a-zA-Z0-9]/g, '');
    const cleanName = removeVietnameseAccents(contributor ? contributor.name : '').replace(/\s+/g, '');
    const desc = `${cleanTripCode} ${cleanName} nop quy`;

    openVietQrModal({
      from: contributor,
      to: treasurer,
      amount: amount
    }, desc);
  }

  function handleConfirmContributeFund() {
    const contributorId = document.getElementById('fund-contributor-select').value;
    const amount = parseFloat(document.getElementById('fund-contribute-amount').value) || 0;

    if (amount <= 0) {
      showToast('Vui lòng nhập số tiền nộp hợp lệ!', 'warning');
      return;
    }

    const contributor = currentTrip.members.find(m => m.id === contributorId);
    if (!currentTrip.fund.contributions) currentTrip.fund.contributions = [];

    currentTrip.fund.contributions.push({
      id: 'c_' + Date.now(),
      memberId: contributorId,
      amount: amount,
      date: new Date().toISOString()
    });

    saveTripsToStorage();
    renderAll();
    renderFundContributionsList();
    showToast(`Đã ghi nhận ${contributor ? contributor.name : ''} nộp ${Number(amount).toLocaleString('vi-VN')} đ vào quỹ!`, 'success');
  }

  function handleDeleteContribution(contribId) {
    if (!confirm('Bạn có chắc muốn xóa khoản nộp quỹ này không?')) return;
    currentTrip.fund.contributions = currentTrip.fund.contributions.filter(c => c.id !== contribId);
    saveTripsToStorage();
    renderAll();
    renderFundContributionsList();
    showToast('Đã xóa khoản nộp quỹ!', 'success');
  }

  function confirmSettleTransaction(transaction) {
    if (!transaction) return;
    if (!confirm(`Bạn xác nhận ${transaction.from.name} đã chuyển trả đủ ${Number(transaction.amount).toLocaleString('vi-VN')} đ cho ${transaction.to.name}?`)) {
      return;
    }

    if (!currentTrip.settlements) currentTrip.settlements = [];
    currentTrip.settlements.push({
      id: 'settle_' + Date.now(),
      fromMemberId: transaction.from.id,
      toMemberId: transaction.to.id,
      amount: transaction.amount,
      date: new Date().toISOString()
    });

    saveTripsToStorage();
    renderAll();
    showToast('Đã ghi nhận thanh toán thành công!', 'success');
  }

  // Switcher & Rooms
  function openTripSwitcherModal() {
    renderRecentTrips();
    openModal('modal-trip-switcher');
  }

  function renderRecentTrips() {
    const container = document.getElementById('recent-trips-list');
    if (!container) return;

    const profile = getUserProfile();
    const myTrips = trips.filter(t => isUserInTrip(t, profile));
    const isAdmin = profile && profile.role === 'admin';
    const otherTrips = isAdmin ? trips.filter(t => !isUserInTrip(t, profile)) : [];

    if (myTrips.length === 0 && otherTrips.length === 0) {
      container.innerHTML = `
        <div style="text-align: center; padding: 24px 12px; color: var(--text-muted); font-size: 0.85rem; border: 1px dashed var(--border-glass); border-radius: var(--radius-md);">
          🏖️ Bạn chưa tham gia chuyến đi nào.<br>
          <span style="font-size: 0.78rem; margin-top: 6px; display: inline-block; color: #94a3b8;">Hãy nhập <strong>Mã phòng</strong> ở trên để xin tham gia hoặc bấm <strong>Tạo chuyến đi mới</strong>!</span>
        </div>
      `;
      return;
    }

    let html = '';

    if (myTrips.length > 0) {
      if (isAdmin && otherTrips.length > 0) {
        html += `<div style="font-size: 0.8rem; font-weight: 700; color: #38bdf8; margin-bottom: 8px;">🌟 Chuyến đi của bạn (${myTrips.length})</div>`;
      }
      html += myTrips.map(t => renderTripCardHtml(t, false, profile)).join('');
    } else if (isAdmin && otherTrips.length > 0) {
      html += `
        <div style="text-align: center; padding: 12px; color: var(--text-muted); font-size: 0.82rem; margin-bottom: 10px; border: 1px dashed var(--border-glass); border-radius: var(--radius-md);">
          Bạn chưa tham gia chuyến đi nào. Dưới đây là các chuyến đi trên hệ thống:
        </div>
      `;
    }

    if (isAdmin && otherTrips.length > 0) {
      html += `
        <div style="margin-top: 18px; margin-bottom: 8px; font-size: 0.8rem; font-weight: 700; color: #f59e0b; display: flex; align-items: center; gap: 6px;">
          <span>🛡️ Tất cả chuyến đi hệ thống (${otherTrips.length} - Quyền Quản trị viên)</span>
        </div>
      `;
      html += otherTrips.map(t => renderTripCardHtml(t, true, profile)).join('');
    }

    container.innerHTML = html;

    container.querySelectorAll('.trip-click-area, .btn-select-trip').forEach(el => {
      el.addEventListener('click', () => {
        const card = el.closest('[data-trip-id]');
        const tid = card ? card.dataset.tripId : el.dataset.tripId;
        const selected = trips.find(x => x.id === tid);
        if (selected) {
          currentTrip = selected;
          localStorage.setItem('tripsplit_current_room', currentTrip.code);
          saveTripsToStorage();
          renderAll();
          closeModal('modal-trip-switcher');
          showToast(`Đã chuyển sang: ${currentTrip.name}`, 'info');
        }
      });
    });

    container.querySelectorAll('.btn-del-trip').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        handleDeleteTrip(btn.dataset.delTripId);
      });
    });
  }

  function renderTripCardHtml(t, isSystem = false, profile = null) {
    const isCurr = currentTrip && (t.id === currentTrip.id);
    const isHost = isUserHostOfTrip(t, profile);
    const isAdmin = profile && profile.role === 'admin';
    const canDelete = isHost || isAdmin;

    return `
      <div style="background: rgba(255,255,255,${isCurr ? '0.08' : '0.03'}); border: 1px solid ${isCurr ? 'var(--primary)' : 'var(--border-glass)'}; border-radius: var(--radius-md); padding: 12px; display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;" data-trip-id="${t.id}">
        <div class="trip-click-area" style="flex: 1; cursor: pointer;">
          <div style="font-weight: 700; color: #fff; display: flex; align-items: center; gap: 6px;">
            <span>${escapeHtml(t.name)}</span>
            ${isCurr ? '🟢' : ''}
            ${isSystem ? '<span style="font-size: 0.65rem; background: rgba(245, 158, 11, 0.2); color: #f59e0b; padding: 2px 6px; border-radius: 4px; font-weight: 600;">Hệ thống</span>' : ''}
          </div>
          <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 2px;">
            Mã: #${t.code} • ${t.members ? t.members.length : 0} người • ${t.expenses ? t.expenses.length : 0} khoản chi
          </div>
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <button class="trip-badge-btn btn-select-trip" data-trip-id="${t.id}">${isCurr ? 'Đang mở' : 'Mở'}</button>
          ${canDelete ? `
            <button class="icon-btn btn-del-trip" data-del-trip-id="${t.id}" title="Xóa chuyến đi" style="width: 32px; height: 32px; color: #f87171; border-color: rgba(239, 68, 68, 0.25); background: rgba(239, 68, 68, 0.08);">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
            </button>
          ` : ''}
        </div>
      </div>
    `;
  }

  function handleDeleteTrip(tripId) {
    const trip = trips.find(t => t.id === tripId);
    if (!trip) return;

    if (!confirm(`Bạn có chắc chắn muốn xóa chuyến đi "${trip.name}" (#${trip.code})?\nToàn bộ dữ liệu chi tiêu và thành viên của chuyến đi này sẽ bị xóa.`)) {
      return;
    }

    trips = trips.filter(t => t.id !== tripId);

    try {
      localStorage.removeItem(`tripsplit_data_${trip.code}`);
      localStorage.removeItem(`tripsplit_timestamp_${trip.code}`);
    } catch (e) {}

    if (currentTrip && currentTrip.id === tripId) {
      currentTrip = null;
      selectInitialTrip();
    }

    saveTripsToStorage();

    // Báo máy chủ xóa chuyến đi (đánh dấu status: 'deleted')
    fetch('/api/trips', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([...trips, { ...trip, status: 'deleted' }])
    }).catch(err => console.warn('Lỗi push xóa trip lên server:', err));

    renderAll();
    renderRecentTrips();
    showToast(`Đã xóa chuyến đi "${trip.name}"!`, 'success');
  }

  // ==========================================================================
  // SERVER INFO & SMART SHARE URL (Tương thích cả Localhost và Hosting)
  // ==========================================================================
  async function fetchServerInfo() {
    try {
      const res = await fetch('/api/info');
      if (res.ok) {
        const data = await res.json();
        if (data && data.localIp && data.localIp !== '127.0.0.1') {
          serverLocalIp = data.localIp;
        }
      }
    } catch (e) {
      // Môi trường static host không có /api/info
    }
  }

  function getShareUrlForTrip(code) {
    if (!code) return '';
    const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    let origin = window.location.origin;

    // Khi chạy trên máy tính dev (localhost / 127.0.0.1), tự động thay thế bằng IP Wi-Fi (ví dụ: 192.168.1.26:8080)
    // để điện thoại bạn bè quét mã QR có thể truy cập được ngay lập tức mà không bị lỗi localhost!
    // KHI ĐƯA LÊN HOSTING (Vercel, Render, Netlify, VPS...):
    // window.location.hostname sẽ là tên miền hosting (như https://abc.com) -> origin sẽ giữ nguyên chuẩn 100%!
    if (isLocal && serverLocalIp) {
      const port = window.location.port ? `:${window.location.port}` : ':8080';
      origin = `http://${serverLocalIp}${port}`;
    }

    return `${origin}${window.location.pathname}?room=${code}`;
  }

  // ==========================================================================
  // QR CAMERA SCANNER CONTROLLER (Quét mã QR tham gia phòng)
  // ==========================================================================
  let html5QrScannerInstance = null;
  let isCameraScanning = false;
  let currentCameraFacingMode = 'environment';
  let availableCameras = [];
  let currentCameraIndex = 0;

  function playQrSuccessTone() {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.12);
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.22);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.22);
    } catch (e) {}
  }

  function parseRoomCodeFromScannedText(text) {
    if (!text || typeof text !== 'string') return '';
    text = text.trim();

    // 1. URL parameter: ?room=CODE hoặc ?trip=CODE
    try {
      const m = text.match(/[?&](?:room|trip)=([A-Za-z0-9_-]+)/i);
      if (m && m[1]) return m[1].toUpperCase();
      if (text.startsWith('http://') || text.startsWith('https://')) {
        const url = new URL(text);
        const r = url.searchParams.get('room') || url.searchParams.get('trip');
        if (r) return r.toUpperCase();
      }
    } catch (e) {}

    // 2. Định dạng room=XYZ hoặc trip=XYZ
    if (/^(?:room|trip)=/i.test(text)) {
      return text.split('=')[1].trim().toUpperCase();
    }

    // 3. Raw alphanumeric code hoặc #CODE
    const clean = text.replace(/^[#@]/, '').trim().toUpperCase();
    return clean;
  }

  // Live Camera Scanner Controller
  async function startQrCameraScan() {
    const laser = document.getElementById('scanner-laser');
    const placeholder = document.getElementById('scanner-idle-placeholder');
    const labelToggle = document.getElementById('label-toggle-camera');
    const btnFlip = document.getElementById('btn-flip-camera');
    const statusText = document.getElementById('scanner-status-text');

    if (!window.Html5Qrcode) {
      showToast('Thư viện quét mã QR chưa sẵn sàng. Vui lòng tải lại trang!', 'warning');
      return;
    }

    const isSecure = window.isSecureContext || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    if (!isSecure && !navigator.mediaDevices?.getUserMedia) {
      showToast('Trình duyệt hạn chế mở Camera trực tiếp qua IP mạng LAN. Hệ thống chuyển sang mở Camera chụp ảnh để quét!', 'info');
      const inputNative = document.getElementById('input-native-camera-capture') || document.getElementById('input-qr-file');
      if (inputNative) inputNative.click();
      return;
    }

    try {
      if (!html5QrScannerInstance) {
        html5QrScannerInstance = new window.Html5Qrcode('qr-reader-view');
      }

      if (isCameraScanning) {
        await stopQrCameraScan();
      }

      if (availableCameras.length === 0) {
        try {
          availableCameras = await window.Html5Qrcode.getCameras();
        } catch (e) {
          availableCameras = [];
        }
      }

      const cameraConfig = availableCameras.length > 0
        ? { deviceId: { exact: availableCameras[currentCameraIndex % availableCameras.length].id } }
        : { facingMode: currentCameraFacingMode };

      const qrConfig = {
        fps: 15,
        qrbox: (viewfinderWidth, viewfinderHeight) => {
          const edge = Math.floor(Math.min(viewfinderWidth, viewfinderHeight) * 0.75);
          return { width: Math.max(180, edge), height: Math.max(180, edge) };
        },
        aspectRatio: 1.0
      };

      await html5QrScannerInstance.start(
        cameraConfig,
        qrConfig,
        (decodedText) => {
          onQrCodeScanned(decodedText);
        },
        () => {}
      );

      isCameraScanning = true;
      if (placeholder) placeholder.style.display = 'none';
      if (laser) laser.style.display = 'block';
      if (labelToggle) labelToggle.textContent = 'Dừng Quét';
      if (btnFlip && availableCameras.length > 1) btnFlip.style.display = 'inline-flex';
      if (statusText) statusText.textContent = 'Đang quét... Căn mã QR vào giữa khung hình';
    } catch (err) {
      console.warn('Không thể mở camera live stream:', err);
      isCameraScanning = false;
      if (placeholder) placeholder.style.display = 'flex';
      if (laser) laser.style.display = 'none';
      if (labelToggle) labelToggle.textContent = 'Bật Camera Quét';
      showToast('Không thể bật camera trực tiếp. Bạn vui lòng chụp ảnh QR để quét!', 'warning');
      const inputNative = document.getElementById('input-native-camera-capture') || document.getElementById('input-qr-file');
      if (inputNative) inputNative.click();
    }
  }

  async function stopQrCameraScan() {
    const laser = document.getElementById('scanner-laser');
    const placeholder = document.getElementById('scanner-idle-placeholder');
    const labelToggle = document.getElementById('label-toggle-camera');
    const statusText = document.getElementById('scanner-status-text');

    if (html5QrScannerInstance && isCameraScanning) {
      try {
        await html5QrScannerInstance.stop();
      } catch (e) {}
    }
    isCameraScanning = false;
    if (placeholder) placeholder.style.display = 'flex';
    if (laser) laser.style.display = 'none';
    if (labelToggle) labelToggle.textContent = 'Bật Camera Quét';
    if (statusText) statusText.textContent = 'Hướng camera vào mã QR chia sẻ từ điện thoại của Trưởng nhóm';
  }

  async function switchQrCamera() {
    if (availableCameras.length > 1) {
      currentCameraIndex = (currentCameraIndex + 1) % availableCameras.length;
      await stopQrCameraScan();
      await startQrCameraScan();
    } else {
      currentCameraFacingMode = currentCameraFacingMode === 'environment' ? 'user' : 'environment';
      await stopQrCameraScan();
      await startQrCameraScan();
    }
  }

  async function decodeQrCodeFromImageFile(file) {
    if (!file) return null;

    let blobUrlToRevoke = null;
    let imgObj = null;

    try {
      // 1. Nạp ảnh siêu tốc qua GPU với createImageBitmap (tự động downscale ngay khi nạp để giải phóng RAM)
      if (typeof createImageBitmap === 'function') {
        try {
          const bitmap = await createImageBitmap(file, { resizeWidth: 640, resizeQuality: 'medium' });
          if (bitmap && bitmap.width > 0 && bitmap.height > 0) {
            imgObj = { source: bitmap, width: bitmap.width, height: bitmap.height, isBitmap: true };
          }
        } catch (e) {
          try {
            const bitmap = await createImageBitmap(file);
            if (bitmap && bitmap.width > 0 && bitmap.height > 0) {
              imgObj = { source: bitmap, width: bitmap.width, height: bitmap.height, isBitmap: true };
            }
          } catch (e2) {}
        }
      }

      // 2. Dự phòng bằng URL.createObjectURL
      if (!imgObj && typeof URL !== 'undefined' && URL.createObjectURL) {
        try {
          blobUrlToRevoke = URL.createObjectURL(file);
          const imgEl = await new Promise((resolve, reject) => {
            const image = new Image();
            image.onload = () => resolve(image);
            image.onerror = (e) => reject(e);
            image.src = blobUrlToRevoke;
          });
          const w = imgEl.naturalWidth || imgEl.width;
          const h = imgEl.naturalHeight || imgEl.height;
          if (w > 0 && h > 0) {
            imgObj = { source: imgEl, width: w, height: h, isBitmap: false };
          }
        } catch (errBlob) {}
      }

      // 3. Dự phòng bằng FileReader Data URL
      if (!imgObj) {
        try {
          const dataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = (e) => reject(e);
            reader.readAsDataURL(file);
          });
          const imgEl = await new Promise((resolve, reject) => {
            const image = new Image();
            image.onload = () => resolve(image);
            image.onerror = (e) => reject(e);
            image.src = dataUrl;
          });
          const w = imgEl.naturalWidth || imgEl.width;
          const h = imgEl.naturalHeight || imgEl.height;
          if (w > 0 && h > 0) {
            imgObj = { source: imgEl, width: w, height: h, isBitmap: false };
          }
        } catch (errReader) {}
      }

      if (!imgObj) return null;

      // 4. QUÉT SIÊU TỐC (<100ms) BẰNG jsQR
      if (window.jsQR) {
        const w = imgObj.width;
        const h = imgObj.height;
        let targetW = w;
        let targetH = h;
        const maxDim = 600;
        if (w > maxDim || h > maxDim) {
          if (w > h) {
            targetH = Math.round((h * maxDim) / w);
            targetW = maxDim;
          } else {
            targetW = Math.round((w * maxDim) / h);
            targetH = maxDim;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(imgObj.source, 0, 0, targetW, targetH);

        // BƯỚC 1: Quét toàn ảnh 600px chế độ thường (nhanh nhất: ~15ms, trúng 85% các trường hợp)
        const fullData = ctx.getImageData(0, 0, targetW, targetH);
        let res = window.jsQR(fullData.data, targetW, targetH, { inversionAttempts: 'dontInvert' });
        if (res && res.data && res.data.trim()) return res.data.trim();

        // BƯỚC 2: Quét vùng trung tâm 65% (ảnh chụp xa hoặc có viền xung quanh: ~10ms)
        const cx = Math.floor(targetW * 0.175);
        const cy = Math.floor(targetH * 0.175);
        const cw = Math.floor(targetW * 0.65);
        const ch = Math.floor(targetH * 0.65);
        if (cw > 40 && ch > 40) {
          const centerData = ctx.getImageData(cx, cy, cw, ch);
          res = window.jsQR(centerData.data, cw, ch, { inversionAttempts: 'dontInvert' });
          if (res && res.data && res.data.trim()) return res.data.trim();
        }

        // BƯỚC 3: Khử sọc nhiễu Moiré màn hình máy tính bằng canvas nhỏ 380px (~12ms)
        const cSmall = document.createElement('canvas');
        const sw = 380;
        const sh = Math.max(30, Math.round((targetH * sw) / targetW));
        cSmall.width = sw;
        cSmall.height = sh;
        const ctxSmall = cSmall.getContext('2d', { willReadFrequently: true });
        ctxSmall.imageSmoothingEnabled = true;
        ctxSmall.drawImage(canvas, 0, 0, sw, sh);

        const smallData = ctxSmall.getImageData(0, 0, sw, sh);
        res = window.jsQR(smallData.data, sw, sh, { inversionAttempts: 'attemptBoth' });
        if (res && res.data && res.data.trim()) return res.data.trim();

        // BƯỚC 4: Lọc ngưỡng tương phản nhanh trên cSmall khử lóa sáng màn hình (~10ms)
        const d = smallData.data;
        let sum = 0;
        const step = 8;
        let samples = 0;
        for (let i = 0; i < d.length; i += step) {
          sum += (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114);
          samples++;
        }
        const avgLum = Math.round(sum / samples);
        for (let i = 0; i < d.length; i += 4) {
          const lum = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
          const v = lum > avgLum ? 255 : 0;
          d[i] = v;
          d[i + 1] = v;
          d[i + 2] = v;
        }
        res = window.jsQR(d, sw, sh, { inversionAttempts: 'dontInvert' });
        if (res && res.data && res.data.trim()) return res.data.trim();
      }

      // 5. Dự phòng cuối cùng: Html5Qrcode.scanFile (ZXing engine)
      if (window.Html5Qrcode) {
        try {
          if (!html5QrScannerInstance) {
            let mountEl = document.getElementById('qr-reader-hidden-view') || document.getElementById('qr-reader-view');
            if (!mountEl) {
              mountEl = document.createElement('div');
              mountEl.id = 'qr-reader-hidden-view';
              mountEl.style.width = '1px';
              mountEl.style.height = '1px';
              mountEl.style.opacity = '0';
              mountEl.style.position = 'absolute';
              mountEl.style.pointerEvents = 'none';
              document.body.appendChild(mountEl);
            }
            html5QrScannerInstance = new window.Html5Qrcode(mountEl.id);
          }
          const text = await html5QrScannerInstance.scanFile(file, false);
          if (text && text.trim()) return text.trim();
        } catch (e) {}
      }
    } catch (outerErr) {
      console.warn('Lỗi xử lý quét QR:', outerErr);
    } finally {
      if (blobUrlToRevoke) {
        try { URL.revokeObjectURL(blobUrlToRevoke); } catch (e) {}
      }
      if (imgObj && imgObj.isBitmap && imgObj.source && imgObj.source.close) {
        try { imgObj.source.close(); } catch (e) {}
      }
    }

    return null;
  }

  function onQrCodeScanned(decodedText) {
    playQrSuccessTone();
    if (navigator.vibrate) navigator.vibrate([60, 50, 80]);

    const code = parseRoomCodeFromScannedText(decodedText);
    if (!code) {
      showToast('Không tìm thấy mã phòng hợp lệ trong mã QR!', 'warning');
      return;
    }

    stopQrCameraScan();
    closeModal('modal-join-room');
    closeModal('modal-start-trip');
    closeModal('modal-trip-switcher');
    showToast(`Đã nhận diện mã phòng #${code}! Đang vào phòng...`, 'success');
    handleJoinRoomWithCode(code);
  }

  async function handleQrFileUpload(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    showToast('⚡ Đang nhận diện mã QR...', 'info');
    setTimeout(async () => {
      try {
        const decodedText = await decodeQrCodeFromImageFile(file);
        if (decodedText) {
          onQrCodeScanned(decodedText);
        } else {
          showToast('Không tìm thấy mã QR trong ảnh. Bạn vui lòng căn góc chụp gần và vuông góc hơn nhé!', 'warning');
        }
      } catch (err) {
        console.warn('Lỗi đọc QR từ file:', err);
        showToast('Không tìm thấy mã QR trong ảnh. Bạn vui lòng thử chụp lại gần hơn nhé!', 'warning');
      }
    }, 20);
    e.target.value = '';
  }

  function openJoinTripModal(autoStartCamera = true) {
    openModal('modal-join-room');
    const inp = document.getElementById('input-join-room-modal');
    if (inp) inp.value = '';
    const boxInline = document.getElementById('box-create-inline');
    if (boxInline) boxInline.style.display = 'none';

    if (autoStartCamera) {
      setTimeout(() => {
        startQrCameraScan();
      }, 350);
    }
  }

  function createNewTrip(name) {
    name = (name || '').trim();
    if (!name) {
      showToast('Vui lòng nhập tên chuyến đi!', 'warning');
      return;
    }

    const profile = getUserProfile();
    const code = 'TRIP' + Math.floor(1000 + Math.random() * 9000);
    const newTrip = {
      id: 'trip_' + Date.now(),
      code: code,
      name: name,
      hostId: profile.id,
      members: [
        {
          id: 'm_' + Date.now(),
          userId: profile.id,
          name: profile.name || 'Bạn',
          phone: profile.phone || '',
          bankCode: profile.bankCode || 'MB',
          accountNo: profile.accountNo || '',
          accountName: profile.accountName || '',
          role: 'host',
          colorIdx: 0
        }
      ],
      pendingMembers: [],
      expenses: [],
      settlements: [],
      fund: {
        enabled: false,
        treasurerId: null,
        contributions: []
      },
      createdAt: new Date().toISOString()
    };

    trips.push(newTrip);
    currentTrip = newTrip;
    saveTripsToStorage();
    renderAll();
    closeModal('modal-trip-switcher');
    closeModal('modal-join-room');
    showToast(`Đã tạo chuyến đi "${name}" với mã phòng #${code}! Bạn là Trưởng nhóm.`, 'success');
  }

  function handleCreateNewTrip() {
    const input = document.getElementById('input-new-trip-name');
    if (!input) return;
    const name = input.value.trim();
    createNewTrip(name);
    input.value = '';
  }

  function handleJoinRoom() {
    const input = document.getElementById('input-join-room');
    const code = input.value.trim().toUpperCase();
    if (!code) {
      showToast('Vui lòng nhập mã phòng!', 'warning');
      return;
    }
    handleJoinRoomWithCode(code);
    input.value = '';
  }

  async function handleJoinRoomWithCode(code) {
    code = (code || '').trim().toUpperCase();
    if (!code) {
      showToast('Vui lòng nhập mã phòng!', 'warning');
      return;
    }

    showToast(`Đang tìm kiếm chuyến đi #${code}...`, 'info');

    // 1. Luôn đồng bộ dữ liệu mới nhất từ máy chủ trước để đảm bảo có thông tin phòng vừa tạo từ thiết bị khác
    await syncTripsWithServer();

    const profile = getUserProfile();
    let found = trips.find(t => t.code === code);

    if (!found) {
      showToast(`Không tìm thấy chuyến đi #${code} trên hệ thống! Vui lòng kiểm tra lại mã phòng hoặc nhờ Trưởng nhóm gửi lại link/QR.`, 'warning');
      return;
    }

    found.pendingMembers = found.pendingMembers || [];
    found.members = found.members || [];

    // Kiểm tra xem đã là thành viên chính thức chưa
    const isMember = found.members.some(m => (m.userId && m.userId === profile.id) || (profile.phone && m.phone === profile.phone));
    const isHost = (found.hostId && found.hostId === profile.id);

    if (isMember || isHost) {
      currentTrip = found;
      localStorage.setItem('tripsplit_current_room', currentTrip.code);
      renderAll();
      closeModal('modal-trip-switcher');
      closeModal('modal-join-room');
      closeModal('modal-start-trip');
      showToast(`Đã vào chuyến đi "${found.name}" (#${code})!`, 'success');
      return;
    }

    // Nếu chưa là thành viên: Gửi yêu cầu xin vào phòng vào pendingMembers
    let req = found.pendingMembers.find(r => r.userId === profile.id);
    if (!req) {
      req = {
        requestId: 'req_' + Date.now(),
        userId: profile.id,
        name: profile.name || 'Bạn',
        phone: profile.phone || '',
        bankCode: profile.bankCode || 'MB',
        accountNo: profile.accountNo || '',
        accountName: profile.accountName || '',
        requestedAt: new Date().toISOString()
      };
      found.pendingMembers.push(req);
      saveTripsToStorage();
    }

    closeModal('modal-trip-switcher');
    closeModal('modal-join-room');
    closeModal('modal-start-trip');
    openWaitingApprovalModal(found, req);
  }

  function openWaitingApprovalModal(trip, req) {
    waitingTripCode = trip.code;
    const nameEl = document.getElementById('waiting-trip-name');
    const codeEl = document.getElementById('waiting-trip-code');
    const hostEl = document.getElementById('waiting-host-name');
    const userEl = document.getElementById('waiting-user-info');

    if (nameEl) nameEl.textContent = trip.name;
    if (codeEl) codeEl.textContent = trip.code;

    const hostMem = (trip.members && trip.members.find(m => m.role === 'host' || m.userId === trip.hostId)) || (trip.members && trip.members[0]);
    if (hostEl) hostEl.textContent = hostMem ? hostMem.name : 'Trưởng nhóm';

    if (userEl) {
      const bankText = req.bankCode && req.accountNo ? `${req.bankCode} • ${req.accountNo} (${req.accountName || ''})` : 'Chưa có STK';
      userEl.innerHTML = `👤 <strong>${escapeHtml(req.name)}</strong>${req.phone ? ` • 📞 ${escapeHtml(req.phone)}` : ''}<br>🏦 ${escapeHtml(bankText)}`;
    }

    openModal('modal-waiting-approval');

    // Tự động kiểm tra liên tục mỗi 2.5 giây xem Trưởng nhóm đã duyệt chưa
    if (waitingApprovalPollTimer) clearInterval(waitingApprovalPollTimer);
    waitingApprovalPollTimer = setInterval(async () => {
      await handleRefreshApprovalStatus(true);
    }, 2500);
  }

  async function handleRefreshApprovalStatus(silent = false) {
    if (!waitingTripCode) {
      if (waitingApprovalPollTimer) {
        clearInterval(waitingApprovalPollTimer);
        waitingApprovalPollTimer = null;
      }
      closeModal('modal-waiting-approval');
      return;
    }

    // Luôn tải dữ liệu mới nhất từ máy chủ để kiểm tra
    await syncTripsWithServer();

    const trip = trips.find(t => t.code === waitingTripCode);
    const profile = getUserProfile();

    if (trip) {
      const isApproved = trip.members && trip.members.some(m => (m.userId && m.userId === profile.id) || m.name === profile.name);
      if (isApproved) {
        if (waitingApprovalPollTimer) {
          clearInterval(waitingApprovalPollTimer);
          waitingApprovalPollTimer = null;
        }
        currentTrip = trip;
        localStorage.setItem('tripsplit_current_room', currentTrip.code);
        renderAll();
        closeModal('modal-waiting-approval');
        playQrSuccessTone();
        showToast('🎉 Chúc mừng! Bạn đã được Trưởng nhóm phê duyệt vào chuyến đi!', 'success');
        return;
      }
    }

    if (!silent) {
      showToast('⏳ Vẫn đang chờ Trưởng nhóm phê duyệt...', 'info');
    }
  }

  function handleCancelJoinRequest() {
    if (waitingApprovalPollTimer) {
      clearInterval(waitingApprovalPollTimer);
      waitingApprovalPollTimer = null;
    }
    if (waitingTripCode) {
      const trip = trips.find(t => t.code === waitingTripCode);
      const profile = getUserProfile();
      if (trip && trip.pendingMembers) {
        trip.pendingMembers = trip.pendingMembers.filter(r => r.userId !== profile.id);
        saveTripsToStorage();
      }
    }
    closeModal('modal-waiting-approval');
    showToast('Đã hủy yêu cầu tham gia.', 'info');
  }

  function openPendingApprovalsModal() {
    renderPendingApprovalsModal();
    openModal('modal-pending-approvals');
  }

  function renderPendingApprovalsModal() {
    const listEl = document.getElementById('modal-pending-list');
    if (!listEl) return;

    if (!currentTrip || !currentTrip.pendingMembers || currentTrip.pendingMembers.length === 0) {
      listEl.innerHTML = `
        <div style="text-align: center; padding: 28px 12px; color: var(--text-muted); font-size: 0.85rem; border: 1px dashed var(--border-glass); border-radius: var(--radius-md);">
          ✨ Hiện tại không có yêu cầu nào đang chờ phê duyệt.
        </div>
      `;
      return;
    }

    listEl.innerHTML = currentTrip.pendingMembers.map(req => {
      const bankStr = req.bankCode && req.accountNo ? `${req.bankCode} • ${req.accountNo}` : 'Chưa có STK';
      return `
        <div class="pending-request-card">
          <div class="request-user-info">
            <div class="member-avatar" style="width: 40px; height: 40px; font-size: 0.9rem; background: linear-gradient(135deg, #f59e0b, #d97706);">${getInitials(req.name)}</div>
            <div class="request-user-details">
              <span class="request-user-name">${escapeHtml(req.name)}</span>
              <span class="request-user-meta">${escapeHtml(req.phone ? req.phone + ' • ' : '')}${escapeHtml(bankStr)}</span>
            </div>
          </div>
          <div class="request-actions">
            <button class="btn-approve-req" data-modal-approve-id="${req.requestId}">✓ Chấp nhận</button>
            <button class="btn-reject-req" data-modal-reject-id="${req.requestId}">✕ Từ chối</button>
          </div>
        </div>
      `;
    }).join('');

    listEl.querySelectorAll('[data-modal-approve-id]').forEach(btn => {
      btn.addEventListener('click', () => {
        handleApproveMember(btn.dataset.modalApproveId);
      });
    });

    listEl.querySelectorAll('[data-modal-reject-id]').forEach(btn => {
      btn.addEventListener('click', () => {
        handleRejectMember(btn.dataset.modalRejectId);
      });
    });
  }

  function handleApproveMember(requestId) {
    if (!currentTrip || !currentTrip.pendingMembers) return;
    const req = currentTrip.pendingMembers.find(r => r.requestId === requestId);
    if (!req) return;

    if (!currentTrip.members) currentTrip.members = [];
    currentTrip.members.push({
      id: 'm_' + Date.now(),
      userId: req.userId,
      name: req.name,
      phone: req.phone || '',
      bankCode: req.bankCode || '',
      accountNo: req.accountNo || '',
      accountName: req.accountName || '',
      role: 'member',
      colorIdx: currentTrip.members.length % AVATAR_COLORS.length
    });

    currentTrip.pendingMembers = currentTrip.pendingMembers.filter(r => r.requestId !== requestId);

    saveTripsToStorage();
    renderAll();
    renderPendingApprovalsModal();
    showToast(`Đã duyệt ${req.name} vào chuyến đi!`, 'success');
  }

  function handleRejectMember(requestId) {
    if (!currentTrip || !currentTrip.pendingMembers) return;
    const req = currentTrip.pendingMembers.find(r => r.requestId === requestId);
    if (!req) return;

    currentTrip.pendingMembers = currentTrip.pendingMembers.filter(r => r.requestId !== requestId);

    saveTripsToStorage();
    renderAll();
    renderPendingApprovalsModal();
    showToast(`Đã từ chối yêu cầu của ${req.name}.`, 'info');
  }

  function handleLeaveTrip() {
    if (!currentTrip) return;
    const profile = getUserProfile();
    const myMem = currentTrip.members.find(m => (m.userId && m.userId === profile.id) || (profile.phone && m.phone && m.phone === profile.phone) || m.name === profile.name || m.name === 'Bạn');

    if (!myMem) {
      showToast('Bạn không phải là thành viên trong chuyến đi này!', 'warning');
      return;
    }

    // Nếu là Host:
    if (isCurrentUserHost() && currentTrip.members.length > 1) {
      alert('👑 Bạn đang là Trưởng nhóm của chuyến đi này.\nĐể đảm bảo an toàn cho nhóm, bạn không thể tự rời phòng khi vẫn còn các thành viên khác. Nếu chuyến đi đã kết thúc, bạn có thể bấm "Xóa Chuyến Đi Này" ở mục Báo cáo.');
      return;
    }

    // Kiểm tra công nợ
    const summary = window.DebtEngine.getTripSummary(currentTrip, currentTrip.members, currentTrip.expenses, currentTrip.settlements);
    const stat = summary.stats[myMem.id] || { netBalance: 0 };

    if (Math.abs(stat.netBalance) > 100) {
      if (stat.netBalance < 0) {
        alert(`⚠️ Bạn hiện vẫn còn nợ ${Math.abs(stat.netBalance).toLocaleString('vi-VN')} đ chưa thanh toán trong chuyến đi này!\nVui lòng chuyển khoản quyết toán trước khi rời khỏi nhóm.`);
      } else {
        alert(`⚠️ Bạn hiện vẫn còn ${stat.netBalance.toLocaleString('vi-VN')} đ được nhận lại từ các thành viên!\nVui lòng thu tiền quyết toán trước khi rời khỏi nhóm.`);
      }
      return;
    }

    if (!confirm(`Bạn có chắc chắn muốn rời khỏi chuyến đi "${currentTrip.name}" (#${currentTrip.code})?`)) {
      return;
    }

    const leavingTrip = currentTrip;

    // 1. Xóa khỏi danh sách members của chuyến đi này
    leavingTrip.members = leavingTrip.members.filter(m => m.id !== myMem.id);

    // 2. Xóa khỏi splits trong các khoản chi nếu có
    if (leavingTrip.expenses) {
      leavingTrip.expenses.forEach(exp => {
        if (exp.splits) {
          exp.splits = exp.splits.filter(s => s.memberId !== myMem.id);
        }
      });
    }

    // 3. Xóa trạng thái phòng hiện tại trên thiết bị này
    localStorage.removeItem('tripsplit_current_room');
    currentTrip = null;

    // 4. Lưu và đẩy ngay lên máy chủ
    saveTripsToStorage(true);

    // 5. Chọn chuyến đi khác nếu còn
    selectInitialTrip();
    renderAll();
    showToast(`Đã rời khỏi chuyến đi "${leavingTrip.name}"!`, 'info');
  }

  // Share Modal
  async function openShareModal() {
    if (!currentTrip) {
      showToast('Vui lòng tạo hoặc tham gia chuyến đi trước!', 'warning');
      openTripSwitcherModal();
      return;
    }

    const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    if (isLocal && !serverLocalIp) {
      await fetchServerInfo();
    }

    const shareUrl = getShareUrlForTrip(currentTrip.code);
    const qrImg = document.getElementById('share-qr-img');
    if (qrImg) {
      qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=${encodeURIComponent(shareUrl)}`;
    }

    const codeDisplay = document.getElementById('share-room-code-display');
    if (codeDisplay) codeDisplay.textContent = currentTrip.code;

    const linkDisplay = document.getElementById('share-link-display');
    if (linkDisplay) linkDisplay.textContent = shareUrl;

    const hostBadge = document.getElementById('share-host-badge');
    if (hostBadge) {
      if (isLocal) {
        hostBadge.innerHTML = `📶 <strong>Mạng Wi-Fi nội bộ:</strong> Quét bằng điện thoại cùng Wi-Fi.<br><span style="font-size: 0.73rem; opacity: 0.85;">🚀 <em>Lưu ý:</em> Khi bạn đưa web lên hosting thực tế (Render, Vercel...), link sẽ tự động đổi thành tên miền hosting (https://...) cho cả mạng 4G/5G!</span>`;
      } else {
        hostBadge.innerHTML = `🌐 <strong>Trực tuyến:</strong> Mọi thiết bị (Wi-Fi, 4G, 5G) đều có thể quét và tham gia chuyến đi ngay lập tức!`;
      }
    }

    openModal('modal-share');
  }

  // Export Summary Infographic Image
  async function openSummaryCardModal() {
    if (!currentTrip) {
      showToast('Vui lòng chọn hoặc tạo chuyến đi trước!', 'warning');
      openTripSwitcherModal();
      return;
    }
    showToast('Đang tạo ảnh tóm tắt chuyến đi...', 'info');
    try {
      const dataUrl = await window.ExportHelper.generateSummaryCardImage(
        currentTrip,
        currentTrip.members,
        currentTrip.expenses,
        currentTrip.settlements
      );
      document.getElementById('summary-card-preview-img').src = dataUrl;
      document.getElementById('btn-download-summary-img').href = dataUrl;
      document.getElementById('btn-download-summary-img').download = `TripSplit_${currentTrip.code}_TongKet.png`;
      openModal('modal-summary-card');
    } catch (e) {
      console.error(e);
      showToast('Có lỗi khi tạo ảnh tóm tắt!', 'warning');
    }
  }

  // ==========================================================================
  // ADMIN USER MANAGEMENT & PASSWORD CONTROLLERS
  // ==========================================================================
  function populateAdminBankDropdown() {
    const select = document.getElementById('new-user-bank-select');
    if (select) select.value = 'MOMO';
  }

  function openAdminUsersModal() {
    if (!window.AuthManager || !window.AuthManager.isAdmin()) {
      showToast('Chỉ Quản trị viên mới có quyền truy cập bảng này!', 'warning');
      return;
    }
    populateAdminBankDropdown();
    renderAdminUsersList();
    openModal('modal-admin-users');
  }

  function renderAdminUsersList() {
    const listEl = document.getElementById('admin-users-list');
    const countEl = document.getElementById('admin-user-count');
    if (!listEl) return;

    const users = window.AuthManager.getAllUsers();
    if (countEl) countEl.textContent = users.length;

    if (users.length === 0) {
      listEl.innerHTML = '<div style="text-align: center; color: var(--text-muted); padding: 16px;">Chưa có người dùng nào.</div>';
      return;
    }

    const currentAuthUser = window.AuthManager.getCurrentUser();

    listEl.innerHTML = users.map((u) => {
      const isMe = currentAuthUser && currentAuthUser.id === u.id;
      const isBlocked = u.status === 'blocked';
      const roleLabel = u.role === 'admin' ? '👑 Admin' : '👤 Thành viên';
      const statusLabel = isBlocked ? 'Đã khóa' : 'Hoạt động';
      const statusClass = isBlocked ? 'blocked' : 'active';
      const bankText = u.bankCode && u.accountNo ? `${u.bankCode} • ${u.accountNo}` : 'Chưa có STK';

      return `
        <div class="admin-user-card ${statusClass}" data-uid="${u.id}">
          <div class="admin-card-header">
            <div class="admin-card-user-info">
              <div class="member-avatar" style="width: 38px; height: 38px; font-size: 0.85rem; background: ${u.role === 'admin' ? 'linear-gradient(135deg, #f59e0b, #d97706)' : 'linear-gradient(135deg, #10b981, #059669)'};">${getInitials(u.name)}</div>
              <div>
                <div style="font-weight: 700; color: #fff; font-size: 0.9rem; display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                  <span>${escapeHtml(u.name)}</span>
                  <span class="role-chip ${u.role}">${roleLabel}</span>
                  ${isMe ? '<span class="role-chip me">Bạn</span>' : ''}
                </div>
                <div style="font-size: 0.72rem; color: var(--text-muted); margin-top: 2px;">
                  ${escapeHtml(u.phone ? u.phone + ' • ' : '')}${escapeHtml(bankText)}
                </div>
              </div>
            </div>
            <span class="admin-badge-status ${statusClass}">${statusLabel}</span>
          </div>

          <!-- Khung thông tin đăng nhập: Mặc định ẩn để thẻ gọn gàng và bảo mật -->
          <div class="admin-card-creds" id="creds-box-${u.id}" style="display: none;">
            <div>
              <span>User: <code>${escapeHtml(u.username)}</code></span> • 
              <span>Pass: <code>${escapeHtml(u.passwordHash)}</code></span>
            </div>
            <button type="button" class="btn-copy-creds" data-copy-user="${u.id}" title="Sao chép thông tin để gửi Zalo / SMS">📋 Gửi Zalo</button>
          </div>

          <!-- Thanh nút thao tác đồng nhất cho tất cả các thẻ -->
          <div class="admin-card-actions">
            <button type="button" class="admin-btn-action edit" data-edit-user="${u.id}">
              ✏️ Sửa
            </button>
            <button type="button" class="admin-btn-action toggle-creds" data-toggle-creds="${u.id}">
              👁️ Đăng nhập
            </button>
            ${!isMe && u.id !== 'usr_admin' ? `
              <button type="button" class="admin-btn-action ${isBlocked ? 'unblock' : 'block'}" data-toggle-user="${u.id}">
                ${isBlocked ? '🔓 Mở' : '🔒 Khóa'}
              </button>
              <button type="button" class="admin-btn-action delete" data-del-user="${u.id}">
                🗑️ Xóa
              </button>
            ` : ''}
          </div>
        </div>
      `;
    }).join('');

    // Sự kiện Ẩn / Hiện thông tin đăng nhập
    listEl.querySelectorAll('[data-toggle-creds]').forEach(btn => {
      btn.addEventListener('click', () => {
        const uid = btn.dataset.toggleCreds;
        const box = document.getElementById(`creds-box-${uid}`);
        if (!box) return;

        const isHidden = box.style.display === 'none' || !box.style.display;
        if (isHidden) {
          box.style.display = 'flex';
          btn.innerHTML = '🙈 Ẩn';
          btn.classList.add('active');
        } else {
          box.style.display = 'none';
          btn.innerHTML = '👁️ Đăng nhập';
          btn.classList.remove('active');
        }
      });
    });

    // Sự kiện Chỉnh sửa tài khoản
    listEl.querySelectorAll('[data-edit-user]').forEach(btn => {
      btn.addEventListener('click', () => {
        const uid = btn.dataset.editUser;
        const u = users.find(x => x.id === uid);
        if (!u) return;

        document.getElementById('admin-edit-user-id').value = u.id;
        document.getElementById('new-user-fullname').value = u.name || '';
        document.getElementById('new-user-username').value = u.username || '';
        document.getElementById('new-user-password').value = u.passwordHash || '';
        document.getElementById('new-user-phone').value = u.phone || '';
        const bankSelect = document.getElementById('new-user-bank-select');
        if (bankSelect) bankSelect.value = 'MOMO';
        document.getElementById('new-user-acc-input').value = u.phone || u.accountNo || '';
        const accNameEl = document.getElementById('new-user-acc-name');
        if (accNameEl) accNameEl.value = u.accountName || '';
        document.getElementById('new-user-role-select').value = u.role || 'member';

        const box = document.getElementById('admin-create-user-box');
        const title = document.getElementById('admin-form-title');
        const submitBtn = document.getElementById('btn-admin-submit-user');

        if (box) box.style.display = 'block';
        if (title) title.textContent = `✏️ Chỉnh Sửa Tài Khoản: ${u.name}`;
        if (submitBtn) submitBtn.textContent = 'Lưu Thay Đổi';

        box.scrollIntoView({ behavior: 'smooth' });
      });
    });

    // Sự kiện Copy thông tin gửi Zalo
    listEl.querySelectorAll('[data-copy-user]').forEach(btn => {
      btn.addEventListener('click', () => {
        const uid = btn.dataset.copyUser;
        const u = users.find(x => x.id === uid);
        if (!u) return;
        const appUrl = window.location.origin + window.location.pathname;
        const msg = `🎉 Xin chào ${u.name}! Đây là thông tin đăng nhập TripSplit của bạn:\n🔗 Link web: ${appUrl}\n👤 Tên đăng nhập: ${u.username}\n🔑 Mật khẩu: ${u.passwordHash}\n(Bạn có thể bấm vào Hồ Sơ Cá Nhân để đổi mật khẩu sau khi đăng nhập nhé!)`;
        copyToClipboard(msg, `Đã copy thông tin tài khoản của ${u.name} để gửi Zalo!`);
      });
    });

    // Sự kiện Khóa / Mở khóa
    listEl.querySelectorAll('[data-toggle-user]').forEach(btn => {
      btn.addEventListener('click', () => {
        const uid = btn.dataset.toggleUser;
        const res = window.AuthManager.toggleBlockUser(uid);
        if (res.success) {
          showToast(res.status === 'blocked' ? 'Đã khóa tài khoản!' : 'Đã mở khóa tài khoản!', 'info');
          renderAdminUsersList();
        } else {
          showToast(res.message, 'warning');
        }
      });
    });

    // Sự kiện Xóa
    listEl.querySelectorAll('[data-del-user]').forEach(btn => {
      btn.addEventListener('click', () => {
        const uid = btn.dataset.delUser;
        const u = users.find(x => x.id === uid);
        if (!confirm(`Bạn có chắc chắn muốn xóa tài khoản "${u ? u.name : uid}" khỏi hệ thống?`)) return;
        const res = window.AuthManager.deleteUser(uid);
        if (res.success) {
          showToast('Đã xóa tài khoản!', 'success');
          renderAdminUsersList();
        } else {
          showToast(res.message, 'warning');
        }
      });
    });
  }

  function handleAdminCreateUserSubmit(e) {
    e.preventDefault();
    const editId = document.getElementById('admin-edit-user-id').value;
    const name = document.getElementById('new-user-fullname').value.trim();
    const username = document.getElementById('new-user-username').value.trim();
    const password = document.getElementById('new-user-password').value.trim();
    const phone = document.getElementById('new-user-phone').value.trim();
    const accountNo = document.getElementById('new-user-acc-input').value.trim();
    const momoPhone = accountNo || phone;
    const bankCode = 'MOMO';
    const accNameEl = document.getElementById('new-user-acc-name');
    const accountName = accNameEl ? accNameEl.value.trim().toUpperCase() : '';
    const role = document.getElementById('new-user-role-select').value;

    if (editId) {
      const res = window.AuthManager.updateUser(editId, {
        name, username, password, phone: phone || momoPhone, bankCode, accountNo: momoPhone, accountName, role
      });

      if (!res.success) {
        showToast(res.message, 'warning');
        return;
      }

      showToast(`Đã cập nhật thông tin tài khoản ${name}!`, 'success');
    } else {
      const res = window.AuthManager.createUser({
        name, username, password, phone: phone || momoPhone, bankCode, accountNo: momoPhone, accountName, role
      });

      if (!res.success) {
        showToast(res.message, 'warning');
        return;
      }

      showToast(`Đã cấp tài khoản thành công cho ${name}!`, 'success');
    }

    resetAdminUserForm();
    renderAdminUsersList();
  }

  function resetAdminUserForm() {
    const form = document.getElementById('form-admin-create-user');
    if (form) form.reset();
    document.getElementById('admin-edit-user-id').value = '';
    const title = document.getElementById('admin-form-title');
    if (title) title.textContent = 'Tạo Tài Khoản Thành Viên Mới';
    const submitBtn = document.getElementById('btn-admin-submit-user');
    if (submitBtn) submitBtn.textContent = 'Xác Nhận Tạo';
    const box = document.getElementById('admin-create-user-box');
    if (box) box.style.display = 'none';
  }

  function handleExportAccounts() {
    const jsonStr = window.AuthManager.exportAccounts();
    if (!jsonStr) return;
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `TripSplit_Accounts_Backup_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Đã sao lưu danh sách tài khoản!', 'success');
  }

  function openChangePasswordModal() {
    document.getElementById('form-change-password').reset();
    openModal('modal-change-password');
  }

  function handleChangePasswordSubmit(e) {
    e.preventDefault();
    const oldP = document.getElementById('pwd-current').value;
    const newP = document.getElementById('pwd-new').value;
    const confP = document.getElementById('pwd-confirm').value;

    if (newP !== confP) {
      showToast('Xác nhận mật khẩu mới không khớp!', 'warning');
      return;
    }

    const res = window.AuthManager.changeMyPassword(oldP, newP);
    if (!res.success) {
      showToast(res.message, 'warning');
      return;
    }

    showToast('Đổi mật khẩu thành công!', 'success');
    closeModal('modal-change-password');
    document.getElementById('form-change-password').reset();
  }

  // ==========================================================================
  // RENAME TRIP CONTROLLERS (Chỉnh sửa tên chuyến đi sau khi tạo)
  // ==========================================================================
  function openRenameTripModal() {
    if (!currentTrip) {
      showToast('Vui lòng chọn hoặc tạo chuyến đi trước!', 'warning');
      return;
    }
    const input = document.getElementById('rename-trip-input');
    if (input) input.value = currentTrip.name;
    openModal('modal-rename-trip');
    setTimeout(() => { if (input) input.focus(); }, 200);
  }

  function handleRenameTripSubmit(e) {
    e.preventDefault();
    if (!currentTrip) return;
    const input = document.getElementById('rename-trip-input');
    const newName = (input.value || '').trim();

    if (!newName) {
      showToast('Vui lòng nhập tên chuyến đi!', 'warning');
      return;
    }

    currentTrip.name = newName;
    saveTripsToStorage();
    renderAll();
    closeModal('modal-rename-trip');
    showToast(`Đã đổi tên chuyến đi thành: "${newName}"!`, 'success');
  }

  // ==========================================================================
  let globalEventListenersBound = false;
  function setupEventListeners() {
    if (globalEventListenersBound) return;
    globalEventListenersBound = true;

    // 1. Tab Navigation
    document.querySelectorAll('.bottom-nav .nav-item').forEach(btn => {
      btn.addEventListener('click', () => {
        const targetTab = btn.dataset.tab;
        switchTab(targetTab);
      });
    });

    // 2. Center FAB Add Button (nếu có)
    const btnOpenAddExp = document.getElementById('btn-open-add-expense');
    if (btnOpenAddExp) btnOpenAddExp.addEventListener('click', openAddExpenseModal);

    // 3. Header Buttons
    document.getElementById('btn-switch-trip').addEventListener('click', openTripSwitcherModal);
    document.getElementById('btn-share-trip').addEventListener('click', openShareModal);
    document.getElementById('btn-copy-code').addEventListener('click', () => {
      if (!currentTrip) return;
      copyToClipboard(currentTrip.code, 'Đã sao chép mã phòng!');
    });

    const btnEditTripName = document.getElementById('btn-edit-trip-name');
    if (btnEditTripName) btnEditTripName.addEventListener('click', openRenameTripModal);

    const formRenameTrip = document.getElementById('form-rename-trip');
    if (formRenameTrip) formRenameTrip.addEventListener('submit', handleRenameTripSubmit);

    // Empty state: Chỉ 1 dòng duy nhất, click mở modal 2 lựa chọn (Tham gia hoặc Tạo mới)
    const btnEmptyStart = document.getElementById('btn-empty-start-trip');
    if (btnEmptyStart) {
      btnEmptyStart.addEventListener('click', () => {
        openModal('modal-start-trip');
      });
    }

    // Modal Bắt Đầu Chuyến Đi (modal-start-trip) - Lựa chọn 1 & 2
    const btnStartCamCapture = document.getElementById('btn-start-camera-capture');
    const inputNativeCam = document.getElementById('input-native-camera-capture');
    if (btnStartCamCapture && inputNativeCam) {
      btnStartCamCapture.addEventListener('click', () => {
        const canUseLiveCam = (window.isSecureContext || location.hostname === 'localhost' || location.hostname === '127.0.0.1') && !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
        if (canUseLiveCam) {
          closeModal('modal-start-trip');
          openJoinTripModal(true);
        } else {
          inputNativeCam.value = '';
          inputNativeCam.click();
        }
      });
      inputNativeCam.addEventListener('change', handleQrFileUpload);
    }

    const btnStartFilePick = document.getElementById('btn-start-file-pick');
    const inputGalleryPick = document.getElementById('input-gallery-file-pick');
    if (btnStartFilePick && inputGalleryPick) {
      btnStartFilePick.addEventListener('click', () => {
        inputGalleryPick.value = '';
        inputGalleryPick.click();
      });
      inputGalleryPick.addEventListener('change', handleQrFileUpload);
    }

    const btnSubmitStartJoin = document.getElementById('btn-submit-start-join');
    const inputStartJoinCode = document.getElementById('input-start-join-code');
    if (btnSubmitStartJoin && inputStartJoinCode) {
      const doStartJoin = () => {
        const code = (inputStartJoinCode.value || '').trim().toUpperCase();
        if (!code) {
          showToast('Vui lòng nhập mã phòng!', 'warning');
          return;
        }
        closeModal('modal-start-trip');
        handleJoinRoomWithCode(code);
        inputStartJoinCode.value = '';
      };
      btnSubmitStartJoin.addEventListener('click', doStartJoin);
      inputStartJoinCode.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          doStartJoin();
        }
      });
    }

    const btnSubmitStartCreate = document.getElementById('btn-submit-start-create');
    const inputStartNewTrip = document.getElementById('input-start-new-trip');
    if (btnSubmitStartCreate && inputStartNewTrip) {
      const doStartCreate = () => {
        const name = (inputStartNewTrip.value || '').trim();
        if (!name) {
          showToast('Vui lòng nhập tên chuyến đi!', 'warning');
          return;
        }
        closeModal('modal-start-trip');
        createNewTrip(name);
        inputStartNewTrip.value = '';
      };
      btnSubmitStartCreate.addEventListener('click', doStartCreate);
      inputStartNewTrip.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          doStartCreate();
        }
      });
    }

    // 4. Quick Action Buttons & Fund
    const btnQuickAddExp = document.getElementById('btn-quick-add-expense');
    if (btnQuickAddExp) btnQuickAddExp.addEventListener('click', openAddExpenseModal);

    const btnTabAddExp = document.getElementById('btn-tab-add-expense');
    if (btnTabAddExp) btnTabAddExp.addEventListener('click', openAddExpenseModal);

    const btnSeeAll = document.getElementById('btn-see-all-expenses');
    if (btnSeeAll) btnSeeAll.addEventListener('click', () => switchTab('tab-expenses'));

    const btnGotoExp = document.getElementById('btn-goto-expenses-tab');
    if (btnGotoExp) btnGotoExp.addEventListener('click', () => switchTab('tab-expenses'));

    const searchInp = document.getElementById('expense-search-input');
    if (searchInp) {
      searchInp.addEventListener('input', () => {
        if (!currentTrip) return;
        const summary = window.DebtEngine.getTripSummary(currentTrip, currentTrip.members, currentTrip.expenses, currentTrip.settlements);
        renderExpenses(summary);
      });
    }

    const btnQuickAddMember = document.getElementById('btn-quick-add-member');
    if (btnQuickAddMember) btnQuickAddMember.addEventListener('click', openAddMemberModal);
    document.getElementById('btn-quick-settle').addEventListener('click', () => switchTab('tab-settlement'));
    document.getElementById('btn-export-quick').addEventListener('click', openSummaryCardModal);
    const btnAddMemTop = document.getElementById('btn-add-member-top');
    if (btnAddMemTop) btnAddMemTop.addEventListener('click', openAddMemberModal);

    // Group Fund (Quỹ Nhóm) Listeners
    const btnOpenFund = document.getElementById('btn-open-fund-modal');
    if (btnOpenFund) btnOpenFund.addEventListener('click', openGroupFundModal);

    const btnQuickFund = document.getElementById('btn-quick-fund');
    if (btnQuickFund) btnQuickFund.addEventListener('click', openGroupFundModal);

    const fundToggleSwitch = document.getElementById('fund-enable-switch');
    if (fundToggleSwitch) {
      fundToggleSwitch.addEventListener('change', (e) => {
        if (!currentTrip) return;
        if (!currentTrip.fund) {
          currentTrip.fund = { enabled: false, treasurerId: currentTrip.members[0]?.id || null, contributions: [] };
        }

        const willEnable = e.target.checked;
        if (!willEnable) {
          const hasFundExpenses = currentTrip.expenses && currentTrip.expenses.some(x => x.payerId === 'group_fund');
          const hasContributions = currentTrip.fund.contributions && currentTrip.fund.contributions.length > 0;
          if (hasFundExpenses || hasContributions) {
            if (!confirm('Chuyến đi này hiện đang có dữ liệu Quỹ nhóm (khoản chi hoặc lượt góp). Nếu tắt, thẻ Quỹ trên màn hình chính sẽ bị ẩn đi. Bạn có chắc muốn tắt không?')) {
              e.target.checked = true;
              return;
            }
          }
        }

        currentTrip.fund.enabled = willEnable;
        if (willEnable && !currentTrip.fund.treasurerId && currentTrip.members[0]) {
          currentTrip.fund.treasurerId = currentTrip.members[0].id;
        }

        saveTripsToStorage();
        renderAll();

        const badge = document.getElementById('fund-toggle-status-badge');
        const body = document.getElementById('fund-modal-body');
        const disabledHint = document.getElementById('fund-modal-disabled-hint');

        if (badge) {
          badge.textContent = willEnable ? 'Đang bật' : 'Đang tắt';
          badge.classList.toggle('active', willEnable);
        }
        if (body) body.style.display = willEnable ? 'block' : 'none';
        if (disabledHint) disabledHint.style.display = willEnable ? 'none' : 'block';

        if (willEnable) {
          showToast('Đã kích hoạt tính năng Quỹ nhóm!', 'success');
        } else {
          showToast('Đã tắt Quỹ nhóm. Giao diện trở nên gọn gàng!', 'info');
        }
      });
    }

    const treasurerSelect = document.getElementById('fund-treasurer-select');
    if (treasurerSelect) {
      treasurerSelect.addEventListener('change', (e) => {
        if (!currentTrip.fund) currentTrip.fund = { enabled: true, treasurerId: null, contributions: [] };
        currentTrip.fund.treasurerId = e.target.value;
        saveTripsToStorage();
        renderAll();
        updateTreasurerBankHint();
        const mem = currentTrip.members.find(m => m.id === e.target.value);
        showToast(`Đã chọn Thủ quỹ: ${mem ? mem.name : ''}`, 'info');
      });
    }

    const btnQrFund = document.getElementById('btn-qr-contribute-fund');
    if (btnQrFund) btnQrFund.addEventListener('click', handleQrContributeFund);

    const btnConfirmFund = document.getElementById('btn-confirm-contribute-fund');
    if (btnConfirmFund) btnConfirmFund.addEventListener('click', handleConfirmContributeFund);

    document.querySelectorAll('.btn-fund-quick').forEach(pill => {
      pill.addEventListener('click', () => {
        document.getElementById('fund-contribute-amount').value = pill.dataset.amt;
      });
    });

    // 5. Category Filter Buttons
    document.querySelectorAll('#cat-filter-bar .filter-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('#cat-filter-bar .filter-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        activeCategoryFilter = chip.dataset.cat;
        const summary = window.DebtEngine.getTripSummary(currentTrip, currentTrip.members, currentTrip.expenses, currentTrip.settlements);
        renderExpenses(summary);
      });
    });

    // 5b. Date Filter Buttons & Custom Date Picker
    document.querySelectorAll('#date-filter-bar .date-filter-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('#date-filter-bar .date-filter-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');

        const customWrapper = document.querySelector('.custom-date-filter-wrapper');
        if (customWrapper) customWrapper.classList.remove('active');
        const clearBtn = document.getElementById('btn-clear-date-filter');
        if (clearBtn) clearBtn.style.display = 'none';

        activeDateFilter = chip.dataset.date;
        customDateFilter = '';
        const customInput = document.getElementById('expense-date-filter-picker');
        if (customInput) customInput.value = '';

        if (currentTrip) {
          const summary = window.DebtEngine.getTripSummary(currentTrip, currentTrip.members, currentTrip.expenses, currentTrip.settlements);
          renderExpenses(summary);
        }
      });
    });

    const customDateInput = document.getElementById('expense-date-filter-picker');
    const clearDateBtn = document.getElementById('btn-clear-date-filter');
    if (customDateInput) {
      customDateInput.addEventListener('change', () => {
        if (!customDateInput.value) return;
        document.querySelectorAll('#date-filter-bar .date-filter-chip').forEach(c => c.classList.remove('active'));
        const customWrapper = document.querySelector('.custom-date-filter-wrapper');
        if (customWrapper) customWrapper.classList.add('active');
        if (clearDateBtn) clearDateBtn.style.display = 'inline-flex';

        activeDateFilter = 'custom';
        customDateFilter = customDateInput.value;

        if (currentTrip) {
          const summary = window.DebtEngine.getTripSummary(currentTrip, currentTrip.members, currentTrip.expenses, currentTrip.settlements);
          renderExpenses(summary);
        }
      });
    }

    if (clearDateBtn) {
      clearDateBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (customDateInput) customDateInput.value = '';
        clearDateBtn.style.display = 'none';
        const customWrapper = document.querySelector('.custom-date-filter-wrapper');
        if (customWrapper) customWrapper.classList.remove('active');

        activeDateFilter = 'all';
        customDateFilter = '';
        const allChip = document.querySelector('#date-filter-bar .date-filter-chip[data-date="all"]');
        if (allChip) allChip.classList.add('active');

        if (currentTrip) {
          const summary = window.DebtEngine.getTripSummary(currentTrip, currentTrip.members, currentTrip.expenses, currentTrip.settlements);
          renderExpenses(summary);
        }
      });
    }

    // 6. Category Selection in Add Modal
    document.querySelectorAll('#category-selector .cat-item').forEach(item => {
      item.addEventListener('click', () => {
        setCategory(item.dataset.val);
      });
    });

    // 7. Split Type Segmented Control
    document.querySelectorAll('#split-type-segments .segment-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        setSplitType(btn.dataset.type);
      });
    });

    // 8. Quick Amount Pills
    document.querySelectorAll('.quick-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        const addVal = parseFloat(pill.dataset.add) || 0;
        const input = document.getElementById('expense-amount');
        const curr = parseFloat(input.value) || 0;
        input.value = curr + addVal;
      });
    });

    // 9. Receipt Photo File Input
    const receiptFileInput = document.getElementById('expense-receipt-file');
    receiptFileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (event) => {
        tempReceiptData = event.target.result;
        document.getElementById('receipt-preview-img').src = tempReceiptData;
        document.getElementById('receipt-preview-thumb').style.display = 'block';
      };
      reader.readAsDataURL(file);
    });

    document.getElementById('btn-remove-receipt').addEventListener('click', () => {
      tempReceiptData = null;
      document.getElementById('expense-receipt-file').value = '';
      document.getElementById('receipt-preview-thumb').style.display = 'none';
    });

    // 10. Form Submits & Deletions
    document.getElementById('form-expense').addEventListener('submit', handleSaveExpense);
    document.getElementById('form-member').addEventListener('submit', handleSaveMember);
    document.getElementById('btn-delete-member').addEventListener('click', () => {
      const mid = document.getElementById('edit-member-id').value;
      handleDeleteMember(mid);
    });
    document.getElementById('btn-delete-expense').addEventListener('click', () => {
      const eid = document.getElementById('edit-expense-id').value;
      handleDeleteExpense(eid);
    });
    document.getElementById('btn-submit-create-trip').addEventListener('click', handleCreateNewTrip);
    document.getElementById('btn-submit-join').addEventListener('click', handleJoinRoom);

    // User Profile & Approvals Listeners
    const btnOpenProfile = document.getElementById('btn-open-user-profile');
    if (btnOpenProfile) btnOpenProfile.addEventListener('click', openUserProfileModal);

    const formProfile = document.getElementById('form-user-profile');
    if (formProfile) formProfile.addEventListener('submit', handleSaveUserProfile);

    const btnOpenApprovals = document.getElementById('btn-open-approvals-modal');
    if (btnOpenApprovals) btnOpenApprovals.addEventListener('click', openPendingApprovalsModal);

    const btnRefreshApproval = document.getElementById('btn-refresh-approval-status');
    if (btnRefreshApproval) btnRefreshApproval.addEventListener('click', handleRefreshApprovalStatus);

    const btnCancelJoinReq = document.getElementById('btn-cancel-join-request');
    if (btnCancelJoinReq) btnCancelJoinReq.addEventListener('click', handleCancelJoinRequest);

    const btnLeaveTrip = document.getElementById('btn-leave-trip');
    if (btnLeaveTrip) btnLeaveTrip.addEventListener('click', handleLeaveTrip);

    // Authentication & Admin Panel Listeners
    const btnAuthLogout = document.getElementById('btn-auth-logout');
    if (btnAuthLogout) btnAuthLogout.addEventListener('click', handleLogout);

    const btnOpenAdminUsers = document.getElementById('btn-open-admin-users');
    if (btnOpenAdminUsers) btnOpenAdminUsers.addEventListener('click', openAdminUsersModal);

    const btnHeaderAdminUsers = document.getElementById('btn-header-admin-users');
    if (btnHeaderAdminUsers) btnHeaderAdminUsers.addEventListener('click', openAdminUsersModal);

    const btnShowCreateUserBox = document.getElementById('btn-show-create-user-form');
    if (btnShowCreateUserBox) {
      btnShowCreateUserBox.addEventListener('click', () => {
        const box = document.getElementById('admin-create-user-box');
        if (box) {
          const isHidden = box.style.display === 'none' || !box.style.display;
          if (isHidden) {
            resetAdminUserForm();
            box.style.display = 'block';
            const inp = document.getElementById('new-user-fullname');
            if (inp) inp.focus();
          } else {
            box.style.display = 'none';
            resetAdminUserForm();
          }
        }
      });
    }

    const btnCancelCreateUser = document.getElementById('btn-cancel-create-user');
    if (btnCancelCreateUser) {
      btnCancelCreateUser.addEventListener('click', () => {
        resetAdminUserForm();
      });
    }

    const formAdminCreateUser = document.getElementById('form-admin-create-user');
    if (formAdminCreateUser) formAdminCreateUser.addEventListener('submit', handleAdminCreateUserSubmit);

    const btnExportAccounts = document.getElementById('btn-export-accounts');
    if (btnExportAccounts) btnExportAccounts.addEventListener('click', handleExportAccounts);

    const btnOpenChangePwd = document.getElementById('btn-open-change-password');
    if (btnOpenChangePwd) btnOpenChangePwd.addEventListener('click', openChangePasswordModal);

    const formChangePwd = document.getElementById('form-change-password');
    if (formChangePwd) formChangePwd.addEventListener('submit', handleChangePasswordSubmit);

    // 11. Modal Close Buttons
    document.querySelectorAll('[data-close-modal]').forEach(btn => {
      btn.addEventListener('click', () => {
        closeModal(btn.dataset.closeModal);
      });
    });

    // Nút mở quét QR từ màn hình Đổi chuyến đi (Trip Switcher)
    const btnOpenScannerSwitcher = document.getElementById('btn-open-scanner-from-switcher');
    if (btnOpenScannerSwitcher) {
      btnOpenScannerSwitcher.addEventListener('click', () => {
        const nativeInput = document.getElementById('input-native-camera-capture');
        if (nativeInput) {
          nativeInput.value = '';
          nativeInput.click();
        } else {
          closeModal('modal-trip-switcher');
          openJoinTripModal(true);
        }
      });
    }

    // Modal Join Trip & QR Scanner listeners
    const btnToggleScan = document.getElementById('btn-toggle-camera-scan');
    if (btnToggleScan) {
      btnToggleScan.addEventListener('click', () => {
        if (isCameraScanning) {
          stopQrCameraScan();
        } else {
          startQrCameraScan();
        }
      });
    }

    const btnFlipCam = document.getElementById('btn-flip-camera');
    if (btnFlipCam) {
      btnFlipCam.addEventListener('click', switchQrCamera);
    }

    const btnTriggerFile = document.getElementById('btn-trigger-file-qr');
    const inputQrFile = document.getElementById('input-qr-file');
    if (btnTriggerFile && inputQrFile) {
      btnTriggerFile.addEventListener('click', () => {
        inputQrFile.click();
      });
      inputQrFile.addEventListener('change', handleQrFileUpload);
    }

    const btnSubmitJoinModal = document.getElementById('btn-submit-join-modal');
    const inputJoinModal = document.getElementById('input-join-room-modal');
    if (btnSubmitJoinModal && inputJoinModal) {
      const doModalJoin = () => {
        const code = (inputJoinModal.value || '').trim().toUpperCase();
        if (!code) {
          showToast('Vui lòng nhập mã phòng!', 'warning');
          return;
        }
        stopQrCameraScan();
        closeModal('modal-join-room');
        handleJoinRoomWithCode(code);
        inputJoinModal.value = '';
      };
      btnSubmitJoinModal.addEventListener('click', doModalJoin);
      inputJoinModal.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          doModalJoin();
        }
      });
    }

    const btnToggleInline = document.getElementById('btn-toggle-create-inline');
    const boxCreateInline = document.getElementById('box-create-inline');
    if (btnToggleInline && boxCreateInline) {
      btnToggleInline.addEventListener('click', () => {
        const isHidden = boxCreateInline.style.display === 'none';
        boxCreateInline.style.display = isHidden ? 'block' : 'none';
        if (isHidden) {
          const inp = document.getElementById('input-new-trip-inline');
          if (inp) inp.focus();
        }
      });
    }

    const btnSubmitCreateInline = document.getElementById('btn-submit-create-inline');
    if (btnSubmitCreateInline) {
      btnSubmitCreateInline.addEventListener('click', () => {
        const inp = document.getElementById('input-new-trip-inline');
        const name = (inp && inp.value ? inp.value.trim() : '');
        if (!name) {
          showToast('Vui lòng nhập tên chuyến đi!', 'warning');
          return;
        }
        stopQrCameraScan();
        closeModal('modal-join-room');
        createNewTrip(name);
        if (inp) inp.value = '';
      });
    }

    // Close on overlay backdrop click
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
          if (overlay.id === 'modal-join-room') {
            stopQrCameraScan();
          }
          overlay.classList.remove('active');
        }
      });
    });

    // 12. Copy Details in VietQR Modal
    document.getElementById('btn-copy-acc').addEventListener('click', () => {
      const acc = document.getElementById('qr-acc-no').textContent;
      copyToClipboard(acc, 'Đã copy số tài khoản!');
    });

    const btnCopyAmtQr = document.getElementById('btn-copy-amount-qr');
    if (btnCopyAmtQr) {
      btnCopyAmtQr.addEventListener('click', () => {
        if (currentQrTransaction) {
          const amt = Number(currentQrTransaction.amount) || 0;
          copyToClipboard(amt.toString(), 'Đã copy số tiền: ' + amt.toLocaleString('vi-VN') + ' đ');
        }
      });
    }

    document.getElementById('btn-copy-desc').addEventListener('click', () => {
      const desc = document.getElementById('qr-desc').textContent;
      copyToClipboard(desc, 'Đã copy nội dung chuyển khoản!');
    });

    document.getElementById('btn-confirm-settled').addEventListener('click', () => {
      if (currentQrTransaction) {
        confirmSettleTransaction(currentQrTransaction);
        closeModal('modal-vietqr');
      }
    });

    // 13. Share Link & Code Copy
    const btnCopyShare = document.getElementById('btn-copy-share-link');
    if (btnCopyShare) {
      btnCopyShare.addEventListener('click', () => {
        if (!currentTrip) return;
        const shareUrl = getShareUrlForTrip(currentTrip.code);
        copyToClipboard(shareUrl, 'Đã copy link mời tham gia chuyến đi!');
      });
    }

    const btnCopyCode = document.getElementById('btn-copy-room-code');
    if (btnCopyCode) {
      btnCopyCode.addEventListener('click', () => {
        if (!currentTrip) return;
        copyToClipboard(currentTrip.code, `Đã copy mã phòng #${currentTrip.code}!`);
      });
    }

    // 14. Export & Trip Management Buttons
    const btnExportExcel = document.getElementById('btn-export-excel');
    if (btnExportExcel) {
      btnExportExcel.addEventListener('click', () => {
        if (!currentTrip) {
          showToast('Vui lòng chọn hoặc tạo chuyến đi trước!', 'warning');
          return;
        }
        window.ExportHelper.exportToExcel(
          currentTrip,
          currentTrip.members,
          currentTrip.expenses,
          currentTrip.settlements
        );
        showToast('Đã tải xuống file Excel báo cáo chi tiêu (kẻ bảng & bôi đen tiêu đề)!', 'success');
      });
    }

    const btnExportCSV = document.getElementById('btn-export-csv');
    if (btnExportCSV) {
      btnExportCSV.addEventListener('click', () => {
        if (!currentTrip) {
          showToast('Vui lòng chọn hoặc tạo chuyến đi trước!', 'warning');
          return;
        }
        window.ExportHelper.exportToCSV(
          currentTrip,
          currentTrip.members,
          currentTrip.expenses,
          currentTrip.settlements
        );
        showToast('Đã tải xuống file CSV dữ liệu thuần!', 'info');
      });
    }

    const btnDelCurrentTrip = document.getElementById('btn-delete-current-trip');
    if (btnDelCurrentTrip) {
      btnDelCurrentTrip.addEventListener('click', () => {
        if (currentTrip) handleDeleteTrip(currentTrip.id);
      });
    }

    document.getElementById('btn-export-summary-card').addEventListener('click', openSummaryCardModal);

    document.getElementById('btn-share-zalo-native').addEventListener('click', async () => {
      if (!currentTrip) return;
      const img = document.getElementById('summary-card-preview-img');
      if (navigator.share && window.fetch) {
        try {
          const res = await fetch(img.src);
          const blob = await res.blob();
          const file = new File([blob], `TripSplit_${currentTrip.code}.png`, { type: 'image/png' });
          await navigator.share({
            title: `Báo cáo chi tiêu: ${currentTrip.name}`,
            text: `Tổng kết chi tiêu chuyến đi #${currentTrip.code} qua TripSplit`,
            files: [file]
          });
        } catch (err) {
          console.warn('Share error:', err);
          showToast('Hãy lưu ảnh về máy và gửi vào Zalo nhé!', 'info');
        }
      } else {
        showToast('Hãy bấm nút Tải ảnh về máy để gửi vào Zalo nhé!', 'info');
      }
    });
  }

  function switchTab(tabId) {
    if (!currentTrip) {
      showToast('Vui lòng tạo hoặc tham gia chuyến đi trước!', 'info');
      openTripSwitcherModal();
      return;
    }
    activeTab = tabId;
    document.querySelectorAll('.tab-view').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.bottom-nav .nav-item').forEach(n => n.classList.remove('active'));

    const tabEl = document.getElementById(tabId);
    if (tabEl) tabEl.classList.add('active');

    const navBtn = document.querySelector(`.bottom-nav [data-tab="${tabId}"]`);
    if (navBtn) navBtn.classList.add('active');

    // FAB (+) removed per user request

    // Cuộn lên đầu
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ==========================================================================
  // PWA INSTALLATION & UTILS
  // ==========================================================================
  function setupPwaServiceWorker() {
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js?v=1.5.1')
          .then(reg => {
            console.log('PWA Service Worker registered:', reg.scope);
            reg.update();
          })
          .catch(err => console.warn('PWA Service Worker registration failed:', err));
      });
    }

    // Kiểm tra nếu là thiết bị iOS (iPhone / iPad) trong Safari
    const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    const isStandalone = window.navigator.standalone || window.matchMedia('(display-mode: standalone)').matches;

    if (isIos && !isStandalone) {
      const banner = document.getElementById('pwa-banner');
      if (banner) {
        banner.innerHTML = `
          <span>🍎 <strong>Dùng iPhone?</strong> Bấm nút <strong>Chia sẻ (⎋)</strong> ở đáy Safari ➔ Chọn <strong>"Thêm vào MH chính"</strong> để dùng toàn màn hình!</span>
          <button class="pwa-banner-btn" onclick="this.parentElement.style.display='none'">Đã hiểu</button>
        `;
        banner.style.display = 'flex';
      }
    }

    // Lắng nghe sự kiện cài đặt ứng dụng Android Chrome
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredInstallPrompt = e;
      const banner = document.getElementById('pwa-banner');
      if (banner) banner.style.display = 'flex';
    });

    const installBtn = document.getElementById('btn-install-pwa');
    if (installBtn) {
      installBtn.addEventListener('click', async () => {
        if (!deferredInstallPrompt) return;
        deferredInstallPrompt.prompt();
        const choice = await deferredInstallPrompt.userChoice;
        if (choice.outcome === 'accepted') {
          showToast('Cảm ơn bạn đã cài đặt TripSplit!', 'success');
        }
        deferredInstallPrompt = null;
        document.getElementById('pwa-banner').style.display = 'none';
      });
    }
  }

  function openModal(modalId) {
    const el = document.getElementById(modalId);
    if (el) el.classList.add('active');
  }

  function closeModal(modalId) {
    if (modalId === 'modal-join-room' || modalId === 'modal-start-trip' || !modalId) {
      stopQrCameraScan();
    }
    if (modalId === 'modal-waiting-approval' || !modalId) {
      if (waitingApprovalPollTimer) {
        clearInterval(waitingApprovalPollTimer);
        waitingApprovalPollTimer = null;
      }
    }
    const el = document.getElementById(modalId);
    if (el) el.classList.remove('active');
  }

  function copyToClipboard(text, successMsg = 'Đã sao chép!') {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => showToast(successMsg, 'success'));
    } else {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      showToast(successMsg, 'success');
    }
  }

  function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 2500);
  }

  function formatRelativeDate(date) {
    const now = new Date();
    const diffDays = Math.floor((now - date) / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return 'Hôm nay';
    if (diffDays === 1) return 'Hôm qua';
    return date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });
  }

  function getInitials(name) {
    if (!name) return 'U';
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function removeVietnameseAccents(str) {
    return str.normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd').replace(/Đ/g, 'D');
  }

  // Khởi động ứng dụng
  window.addEventListener('DOMContentLoaded', init);

})();
