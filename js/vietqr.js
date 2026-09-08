/**
 * TRIPSPLIT - VIETQR & MOMO PAYMENT HELPER MODULE
 * Hỗ trợ chuẩn VietQR Ví MoMo (BIN 971025 - CTCP Dịch Vụ Di Động Trực Tuyến)
 * và MoMo Deep Link P2P
 */
const VietQRHelper = {
  // Mã định danh NAPAS của Ví MoMo
  MOMO_BIN: '971025',

  /**
   * Hàm tính checksum CRC16-CCITT chuẩn EMVCo (Polynomial 0x1021, Initial 0xFFFF)
   */
  crc16(str) {
    let crc = 0xFFFF;
    for (let c = 0; c < str.length; c++) {
      const byte = str.charCodeAt(c);
      crc ^= (byte << 8);
      for (let i = 0; i < 8; i++) {
        if ((crc & 0x8000) !== 0) {
          crc = ((crc << 1) ^ 0x1021) & 0xFFFF;
        } else {
          crc = (crc << 1) & 0xFFFF;
        }
      }
    }
    const hex = crc.toString(16).toUpperCase();
    return ('0000' + hex).slice(-4);
  },

  /**
   * Helper đóng gói Tag-Length-Value theo chuẩn EMVCo
   */
  buildTag(id, val) {
    const valStr = String(val || '');
    const len = ('00' + valStr.length).slice(-2);
    return id + len + valStr;
  },

  /**
   * Chuyển chuỗi tiếng Việt có dấu sang không dấu (chuẩn EMVCo VietQR)
   */
  stripAccents(str) {
    if (!str) return '';
    return str
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'D')
      .trim();
  },

  /**
   * Sinh chuỗi dữ liệu EMVCo VietQR chuẩn cho Ví MoMo (BIN 971025)
   * Khi quét bằng App MoMo ("Quét mọi QR") hoặc bất kỳ app Ngân Hàng nào:
   * Tự động nhận diện Ví MoMo, Số điện thoại, Tên người nhận, Số tiền và Nội dung!
   */
  generateMoMoVietQrPayload(phone, amount, desc = '', accountName = '') {
    const cleanPhone = (phone || '').replace(/\D/g, '');
    if (!cleanPhone) return null;

    const numAmount = Math.round(Number(amount) || 0);
    const cleanAmount = numAmount > 0 ? String(numAmount) : '';
    const cleanDesc = this.stripAccents(desc).substring(0, 25);
    const cleanName = this.stripAccents(accountName).toUpperCase().substring(0, 25);

    // Tag 38: Thông tin tài khoản thụ hưởng (Consumer Account Information)
    const sub00 = this.buildTag('00', 'A000000727'); // NAPAS GUID
    const subOrg = this.buildTag('00', this.MOMO_BIN) + this.buildTag('01', cleanPhone); // MoMo BIN + SĐT
    const sub01 = this.buildTag('01', subOrg);
    const sub02 = this.buildTag('02', 'QRIBFTTA'); // Dịch vụ chuyển nhanh Napas
    const tag38 = this.buildTag('38', sub00 + sub01 + sub02);

    // Tag 00: Phiên bản payload (01)
    const tag00 = this.buildTag('00', '01');
    // Tag 01: Loại QR: '12' (Động có số tiền) hoặc '11' (Tĩnh không số tiền)
    const tag01 = this.buildTag('01', cleanAmount ? '12' : '11');
    // Tag 53: Đơn vị tiền tệ (704 = VND)
    const tag53 = this.buildTag('53', '704');
    // Tag 54: Số tiền giao dịch
    const tag54 = cleanAmount ? this.buildTag('54', cleanAmount) : '';
    // Tag 58: Mã quốc gia (VN)
    const tag58 = this.buildTag('58', 'VN');
    // Tag 59: Tên người nhận
    const tag59 = cleanName ? this.buildTag('59', cleanName) : '';
    // Tag 62: Thông tin bổ sung (Nội dung chuyển tiền)
    const tag62 = cleanDesc ? this.buildTag('62', this.buildTag('08', cleanDesc)) : '';

    // Tag 63: Checksum CRC16
    const raw = tag00 + tag01 + tag38 + tag53 + tag54 + tag58 + tag59 + tag62 + '6304';
    const checksum = this.crc16(raw);
    return raw + checksum;
  },

  /**
   * Tạo URL hình ảnh mã QR Ví MoMo chính thức
   * Ưu tiên 1: VietQR chính thức MoMo (BIN 971025) qua img.vietqr.io với khung nhận diện MoMo
   * Ưu tiên 2: Nếu chỉ có link cá nhân me.momo.vn
   */
  generateMoMoQrUrl(phone, amount, description = '', accountName = '', momoLink = null) {
    const cleanPhone = (phone || '').replace(/\D/g, '');
    const numAmount = Math.round(Number(amount) || 0);
    const cleanDesc = this.stripAccents(description);
    const cleanName = this.stripAccents(accountName).toUpperCase();

    // 1. Nếu có SĐT: Sinh mã VietQR chuẩn MoMo (BIN 971025)
    // Khi quét bằng MoMo: Tự nhận diện Ví MoMo, Tên người nhận và TỰ ĐỘNG ĐIỀN SỐ TIỀN!
    if (cleanPhone) {
      const queryParts = [];
      if (numAmount > 0) queryParts.push('amount=' + encodeURIComponent(numAmount));
      if (cleanDesc) queryParts.push('addInfo=' + encodeURIComponent(cleanDesc));
      if (cleanName) queryParts.push('accountName=' + encodeURIComponent(cleanName));
      const queryString = queryParts.length ? '?' + queryParts.join('&') : '';

      return `https://img.vietqr.io/image/${this.MOMO_BIN}-${cleanPhone}-compact2.png${queryString}`;
    }

    // 2. Nếu không có SĐT nhưng có Link nhận tiền me.momo.vn
    if (momoLink && typeof momoLink === 'string' && momoLink.trim()) {
      let targetUrl = momoLink.trim();
      if (!/^https?:\/\//i.test(targetUrl)) targetUrl = 'https://' + targetUrl;
      return `https://api.qrserver.com/v1/create-qr-code/?size=360x360&margin=12&data=${encodeURIComponent(targetUrl)}`;
    }

    return null;
  },

  /**
   * Fallback URL tạo QR nguyên bản (khi img.vietqr.io không tải được)
   * Sử dụng payload EMVCo đã được đóng gói chuẩn 100%
   */
  getMoMoFallbackQrUrl(phone, amount, description = '', accountName = '') {
    const payload = this.generateMoMoVietQrPayload(phone, amount, description, accountName);
    if (!payload) return null;
    return `https://api.qrserver.com/v1/create-qr-code/?size=360x360&margin=12&data=${encodeURIComponent(payload)}`;
  },

  /**
   * Tương thích ngược với các hàm gọi cũ
   */
  generateBankVietQrUrl(accountNo, amount, description = '', accountName = '', momoLink = null) {
    return this.generateMoMoQrUrl(accountNo, amount, description, accountName, momoLink);
  },

  generateImageUrl(bankCode, accountNo, amount, description = '', accountName = '', momoLink = null) {
    return this.generateMoMoQrUrl(accountNo, amount, description, accountName, momoLink);
  },

  /**
   * Lấy Link mở MoMo cá nhân
   */
  getMoMoUniversalLink(phone, customLink = null) {
    if (customLink && typeof customLink === 'string' && customLink.trim()) {
      let finalLink = customLink.trim();
      if (!/^https?:\/\//i.test(finalLink)) finalLink = 'https://' + finalLink;
      return finalLink;
    }
    return 'momo://';
  },

  /**
   * Mở ứng dụng MoMo trên điện thoại
   */
  openMoMoApp(phone, amount, description, customLink = null) {
    const cleanPhone = (phone || '').replace(/\D/g, '');
    const numAmount = Math.round(Number(amount) || 0);

    // 1. Tự động sao chép số tiền vào clipboard nếu có
    if (numAmount > 0 && navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(String(numAmount)).catch(() => {});
    }

    // 2. Nếu người dùng có Link cá nhân me.momo.vn
    if (customLink && typeof customLink === 'string' && customLink.trim()) {
      let finalLink = customLink.trim();
      if (!/^https?:\/\//i.test(finalLink)) finalLink = 'https://' + finalLink;
      window.open(finalLink, '_blank');
      return true;
    }

    // 3. Nếu chưa có link cá nhân, sao chép SĐT và mở App MoMo sạch
    if (cleanPhone && navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(cleanPhone).catch(() => {});
    }
    return this.openMoMoSchemeDirectly(cleanPhone);
  },

  /**
   * Mở scheme momo:// trực tiếp trên điện thoại
   */
  openMoMoSchemeDirectly(phone) {
    const isAndroid = /Android/i.test(navigator.userAgent);
    let momoUrl = 'momo://';
    if (isAndroid) {
      momoUrl = 'intent://#Intent;scheme=momo;package=com.mservice.momotransfer;end';
    }

    const link = document.createElement('a');
    link.href = momoUrl;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    setTimeout(() => {
      if (link.parentNode) link.parentNode.removeChild(link);
    }, 800);

    return true;
  },

  /**
   * Tải ảnh mã QR về máy
   */
  async downloadQrImage(bankCode, accountNo, amount, description = '', accountName = '', isMoMoNative = true) {
    let qrUrl = this.generateMoMoQrUrl(accountNo, amount, description, accountName);
    if (!qrUrl) return false;

    try {
      const res = await fetch(qrUrl);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `MoMo-${accountNo}-${amount}.png`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        if (a.parentNode) a.parentNode.removeChild(a);
        URL.revokeObjectURL(blobUrl);
      }, 500);
      return true;
    } catch (e) {
      window.open(qrUrl, '_blank');
      return true;
    }
  }
};

if (typeof window !== 'undefined') {
  window.VietQRHelper = VietQRHelper;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = VietQRHelper;
}
