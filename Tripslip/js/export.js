/**
 * Module Xuất Báo Cáo: Excel (.XLS có kẻ bảng & bôi đen tiêu đề), CSV & Ảnh Tóm Tắt Infographic Zalo
 */
const ExportHelper = {
  escapeXml(str) {
    if (!str && str !== 0) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  },

  /**
   * Xuất báo cáo dạng Excel (.XLS) chuyên nghiệp
   * - Bôi đen toàn bộ các ô tiêu đề chính và tiêu đề cột với chữ trắng in đậm
   * - Kẻ bảng sắc nét từng ô, từng cột chuẩn kế toán
   * - Tự động định dạng số tiền có dấu phân cách hàng nghìn
   * - Hiển thị màu sắc trạng thái thu/chi rõ ràng
   */
  exportToExcel(trip, members, expenses, settlements) {
    const htmlContent = this.buildExcelHtml(trip, members, expenses, settlements);
    const blob = new Blob([htmlContent], { type: 'application/vnd.ms-excel;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `BaoCao_TripSplit_${trip.code || 'TRIP'}_${Date.now()}.xls`);
    document.body.appendChild(link);
    link.click();
    setTimeout(() => {
      if (link.parentNode) link.parentNode.removeChild(link);
      URL.revokeObjectURL(url);
    }, 600);
  },

  /**
   * Tạo chuỗi HTML Spreadsheet chuẩn cho Excel (.XLS)
   */
  buildExcelHtml(trip, members, expenses, settlements) {
    const memberMap = {};
    members.forEach(m => { memberMap[m.id] = m.name; });

    const summary = window.DebtEngine ? window.DebtEngine.getTripSummary(trip, members, expenses, settlements) : { stats: {}, transactions: [], totalSpent: 0 };
    const totalSpent = summary.totalSpent || expenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
    const avgPerPerson = summary.avgPerPerson || (members.length ? Math.round(totalSpent / members.length) : 0);
    const exportDateStr = new Date().toLocaleString('vi-VN', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });

    let html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" 
      xmlns:x="urn:schemas-microsoft-com:office:excel" 
      xmlns="http://www.w3.org/TR/REC-html40">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
  <!--[if gte mso 9]>
  <xml>
    <x:ExcelWorkbook>
      <x:ExcelWorksheets>
        <x:ExcelWorksheet>
          <x:Name>Bao Cao Chi Tieu</x:Name>
          <x:WorksheetOptions>
            <x:DisplayGridlines/>
          </x:WorksheetOptions>
        </x:ExcelWorksheet>
      </x:ExcelWorksheets>
    </x:ExcelWorkbook>
  </xml>
  <![endif]-->
  <style>
    body { font-family: 'Segoe UI', Calibri, Arial, sans-serif; }
    table { border-collapse: collapse; width: 100%; margin-bottom: 24px; }
    
    /* Ô tiêu đề chính bôi đen */
    .title-row {
      background-color: #0f172a !important;
      color: #ffffff !important;
      font-size: 15pt !important;
      font-weight: bold !important;
      text-align: center !important;
      padding: 14px 10px !important;
      border: 1.5px solid #0f172a !important;
    }

    /* Dòng thông tin metadata */
    .meta-row td {
      background-color: #f8fafc !important;
      color: #334155 !important;
      font-size: 10pt !important;
      border: 1px solid #94a3b8 !important;
      padding: 6px 10px !important;
    }

    /* Tiêu đề từng phần bôi đen */
    .section-header {
      background-color: #0f172a !important;
      color: #38bdf8 !important;
      font-size: 11.5pt !important;
      font-weight: bold !important;
      padding: 10px 12px !important;
      border: 1.5px solid #0f172a !important;
    }

    /* Header cột bôi đen chữ trắng */
    th {
      background-color: #1e293b !important;
      color: #ffffff !important;
      font-weight: bold !important;
      border: 1.5px solid #475569 !important;
      padding: 9px 8px !important;
      text-align: center !important;
      vertical-align: middle !important;
    }

    /* Ô dữ liệu có kẻ bảng rõ nét */
    td {
      border: 1px solid #94a3b8 !important;
      padding: 7px 10px !important;
      font-size: 10.5pt !important;
      vertical-align: middle !important;
      color: #0f172a !important;
    }

    /* Căn lề và định dạng số */
    .center { text-align: center !important; }
    .right { text-align: right !important; mso-number-format: '#,##0'; }
    .left { text-align: left !important; }
    .bold { font-weight: bold !important; }

    /* Dòng tổng cộng */
    .total-row td {
      background-color: #f1f5f9 !important;
      font-weight: bold !important;
      border-top: 2px solid #0f172a !important;
      border-bottom: 2px solid #0f172a !important;
    }

    /* Huy hiệu trạng thái thu chi */
    .badge-credit {
      background-color: #dcfce7 !important;
      color: #15803d !important;
      font-weight: bold !important;
      text-align: center !important;
    }
    .badge-debt {
      background-color: #fee2e2 !important;
      color: #b91c1c !important;
      font-weight: bold !important;
      text-align: center !important;
    }
    .badge-even {
      background-color: #f1f5f9 !important;
      color: #64748b !important;
      text-align: center !important;
    }
  </style>
</head>
<body style="font-family: 'Segoe UI', Calibri, Arial, sans-serif; padding: 12px;">

  <!-- ================= BẢNG THÔNG TIN CHUNG ================= -->
  <table border="1" cellpadding="8" cellspacing="0" style="border-collapse: collapse; width: 100%; margin-bottom: 22px; border: 1.5px solid #0f172a;">
    <tr>
      <td colspan="8" class="title-row" bgcolor="#0f172a" style="background-color: #0f172a; color: #ffffff; font-size: 15pt; font-weight: bold; text-align: center; padding: 14px 10px; border: 1.5px solid #0f172a;">
        BÁO CÁO TỔNG HỢP CHI TIÊU &amp; QUYẾT TOÁN CHUYẾN ĐI
      </td>
    </tr>
    <tr class="meta-row" bgcolor="#f8fafc">
      <td colspan="4" style="border: 1px solid #94a3b8; padding: 8px 10px; font-size: 10.5pt; color: #1e293b;">
        <strong>Chuyến đi:</strong> ${this.escapeXml(trip.name || 'Du lịch')} (Mã: #${this.escapeXml(trip.code || 'TRIP')})
      </td>
      <td colspan="4" align="right" style="border: 1px solid #94a3b8; padding: 8px 10px; font-size: 10.5pt; text-align: right; color: #1e293b;">
        <strong>Ngày xuất báo cáo:</strong> ${this.escapeXml(exportDateStr)}
      </td>
    </tr>
    <tr class="meta-row" bgcolor="#f8fafc">
      <td colspan="2" style="border: 1px solid #94a3b8; padding: 8px 10px; font-size: 10.5pt; color: #1e293b;">
        <strong>Số lượng thành viên:</strong> ${members.length} người
      </td>
      <td colspan="3" style="border: 1px solid #94a3b8; padding: 8px 10px; font-size: 10.5pt; color: #1e293b;">
        <strong>Tổng chi tiêu cả chuyến:</strong> <span style="color: #059669; font-weight: bold; font-size: 11pt;">${totalSpent.toLocaleString('vi-VN')} VND</span>
      </td>
      <td colspan="3" align="right" style="border: 1px solid #94a3b8; padding: 8px 10px; font-size: 10.5pt; text-align: right; color: #1e293b;">
        <strong>Trung bình mỗi người:</strong> ${avgPerPerson.toLocaleString('vi-VN')} VND
      </td>
    </tr>
  </table>

  <!-- ================= BẢNG 1: DANH SÁCH CÁC KHOẢN CHI TIÊU ================= -->
  <table border="1" cellpadding="7" cellspacing="0" style="border-collapse: collapse; width: 100%; margin-bottom: 22px; border: 1.5px solid #0f172a;">
    <tr>
      <td colspan="8" class="section-header" bgcolor="#0f172a" style="background-color: #0f172a; color: #38bdf8; font-size: 11.5pt; font-weight: bold; padding: 10px 12px; border: 1.5px solid #0f172a;">
        1. DANH SÁCH CHI TIẾT CÁC KHOẢN CHI TIÊU (${expenses.length} KHOẢN)
      </td>
    </tr>
    <tr>
      <th bgcolor="#1e293b" style="background-color: #1e293b; color: #ffffff; font-weight: bold; border: 1.5px solid #475569; padding: 9px 8px; text-align: center; width: 45px;">STT</th>
      <th bgcolor="#1e293b" style="background-color: #1e293b; color: #ffffff; font-weight: bold; border: 1.5px solid #475569; padding: 9px 8px; text-align: center; width: 140px;">Thời gian</th>
      <th bgcolor="#1e293b" style="background-color: #1e293b; color: #ffffff; font-weight: bold; border: 1.5px solid #475569; padding: 9px 8px; text-align: center; width: 220px;">Nội dung chi tiêu</th>
      <th bgcolor="#1e293b" style="background-color: #1e293b; color: #ffffff; font-weight: bold; border: 1.5px solid #475569; padding: 9px 8px; text-align: center; width: 130px;">Danh mục</th>
      <th bgcolor="#1e293b" style="background-color: #1e293b; color: #ffffff; font-weight: bold; border: 1.5px solid #475569; padding: 9px 8px; text-align: center; width: 140px;">Số tiền (VND)</th>
      <th bgcolor="#1e293b" style="background-color: #1e293b; color: #ffffff; font-weight: bold; border: 1.5px solid #475569; padding: 9px 8px; text-align: center; width: 130px;">Người chi trả</th>
      <th bgcolor="#1e293b" style="background-color: #1e293b; color: #ffffff; font-weight: bold; border: 1.5px solid #475569; padding: 9px 8px; text-align: center; width: 110px;">Hình thức chia</th>
      <th bgcolor="#1e293b" style="background-color: #1e293b; color: #ffffff; font-weight: bold; border: 1.5px solid #475569; padding: 9px 8px; text-align: center; width: 190px;">Thành viên tham gia</th>
    </tr>`;

    if (expenses.length === 0) {
      html += `<tr><td colspan="8" align="center" style="border: 1px solid #94a3b8; text-align: center; color: #64748b; padding: 14px;">Chưa có khoản chi tiêu nào trong chuyến đi này.</td></tr>`;
    } else {
      expenses.forEach((e, idx) => {
        const payerName = memberMap[e.payerId] || 'Không rõ';
        const dateStr = e.date ? new Date(e.date).toLocaleString('vi-VN') : '';
        const catName = this.getCategoryLabel(e.category);
        const splitTypeStr = this.getSplitTypeLabel(e.splitType);
        
        let splitMembersStr = 'Tất cả';
        if (e.splits && e.splits.length > 0) {
          splitMembersStr = e.splits
            .filter(s => s.isIncluded !== false)
            .map(s => memberMap[s.memberId] || '')
            .filter(Boolean)
            .join('; ');
        }

        const rowBg = (idx % 2 === 0) ? '#ffffff' : '#f8fafc';

        html += `
        <tr bgcolor="${rowBg}">
          <td align="center" style="border: 1px solid #94a3b8; text-align: center; padding: 7px 8px;">${idx + 1}</td>
          <td align="center" style="border: 1px solid #94a3b8; text-align: center; padding: 7px 8px; white-space: nowrap;">${this.escapeXml(dateStr)}</td>
          <td style="border: 1px solid #94a3b8; padding: 7px 10px;"><strong>${this.escapeXml(e.title || 'Khoản chi')}</strong></td>
          <td align="center" style="border: 1px solid #94a3b8; text-align: center; padding: 7px 8px;">${this.escapeXml(catName)}</td>
          <td align="right" class="right bold" style="border: 1px solid #94a3b8; text-align: right; font-weight: bold; color: #059669; padding: 7px 10px; mso-number-format: '#,##0';">
            ${Number(e.amount || 0).toLocaleString('vi-VN')}
          </td>
          <td style="border: 1px solid #94a3b8; padding: 7px 10px;">${this.escapeXml(payerName)}</td>
          <td align="center" style="border: 1px solid #94a3b8; text-align: center; padding: 7px 8px;">${this.escapeXml(splitTypeStr)}</td>
          <td style="border: 1px solid #94a3b8; padding: 7px 10px;">${this.escapeXml(splitMembersStr)}</td>
        </tr>`;
      });

      html += `
      <tr class="total-row" bgcolor="#f1f5f9">
        <td colspan="4" align="center" style="border: 1px solid #94a3b8; border-top: 2px solid #0f172a; border-bottom: 2px solid #0f172a; text-align: center; font-weight: bold; padding: 9px 10px;">
          TỔNG CỘNG CHI TIÊU (${expenses.length} KHOẢN CHI)
        </td>
        <td align="right" class="right bold" style="border: 1px solid #94a3b8; border-top: 2px solid #0f172a; border-bottom: 2px solid #0f172a; text-align: right; font-weight: bold; color: #059669; font-size: 11pt; padding: 9px 10px; mso-number-format: '#,##0';">
          ${totalSpent.toLocaleString('vi-VN')}
        </td>
        <td colspan="3" style="border: 1px solid #94a3b8; border-top: 2px solid #0f172a; border-bottom: 2px solid #0f172a; padding: 9px 10px;"></td>
      </tr>`;
    }

    html += `</table>`;

    // ================= BẢNG 2: TỔNG KẾT THU CHI CÁ NHÂN =================
    html += `
    <table border="1" cellpadding="7" cellspacing="0" style="border-collapse: collapse; width: 100%; margin-bottom: 22px; border: 1.5px solid #0f172a;">
      <tr>
        <td colspan="5" class="section-header" bgcolor="#0f172a" style="background-color: #0f172a; color: #38bdf8; font-size: 11.5pt; font-weight: bold; padding: 10px 12px; border: 1.5px solid #0f172a;">
          2. BẢNG TỔNG KẾT THU CHI CÁ NHÂN &amp; SỐ DƯ RÒNG
        </td>
      </tr>
      <tr>
        <th bgcolor="#1e293b" style="background-color: #1e293b; color: #ffffff; font-weight: bold; border: 1.5px solid #475569; padding: 9px 8px; text-align: center; width: 180px;">Thành viên</th>
        <th bgcolor="#1e293b" style="background-color: #1e293b; color: #ffffff; font-weight: bold; border: 1.5px solid #475569; padding: 9px 8px; text-align: center; width: 160px;">Tổng tiền đã chi trả (VND)</th>
        <th bgcolor="#1e293b" style="background-color: #1e293b; color: #ffffff; font-weight: bold; border: 1.5px solid #475569; padding: 9px 8px; text-align: center; width: 160px;">Tổng tiền phải chịu (VND)</th>
        <th bgcolor="#1e293b" style="background-color: #1e293b; color: #ffffff; font-weight: bold; border: 1.5px solid #475569; padding: 9px 8px; text-align: center; width: 160px;">Số dư ròng (+ / -) (VND)</th>
        <th bgcolor="#1e293b" style="background-color: #1e293b; color: #ffffff; font-weight: bold; border: 1.5px solid #475569; padding: 9px 8px; text-align: center; width: 150px;">Trạng thái quyết toán</th>
      </tr>`;

    let sumPaid = 0;
    let sumOwed = 0;

    members.forEach((m, idx) => {
      const stat = summary.stats[m.id] || { totalPaid: 0, totalOwed: 0, netBalance: 0 };
      sumPaid += stat.totalPaid;
      sumOwed += stat.totalOwed;

      let badgeBg = '#f1f5f9';
      let badgeColor = '#64748b';
      let statusStr = 'Hòa vốn';
      let balancePrefix = '';

      if (stat.netBalance > 0) {
        badgeBg = '#dcfce7';
        badgeColor = '#15803d';
        statusStr = 'Được nhận lại';
        balancePrefix = '+';
      } else if (stat.netBalance < 0) {
        badgeBg = '#fee2e2';
        badgeColor = '#b91c1c';
        statusStr = 'Cần chuyển trả';
      }

      const rowBg = (idx % 2 === 0) ? '#ffffff' : '#f8fafc';

      html += `
      <tr bgcolor="${rowBg}">
        <td style="border: 1px solid #94a3b8; padding: 7px 10px;"><strong>${this.escapeXml(m.name)}</strong></td>
        <td align="right" class="right" style="border: 1px solid #94a3b8; text-align: right; padding: 7px 10px; mso-number-format: '#,##0';">${Number(stat.totalPaid || 0).toLocaleString('vi-VN')}</td>
        <td align="right" class="right" style="border: 1px solid #94a3b8; text-align: right; padding: 7px 10px; mso-number-format: '#,##0';">${Number(stat.totalOwed || 0).toLocaleString('vi-VN')}</td>
        <td align="right" class="right bold" style="border: 1px solid #94a3b8; text-align: right; font-weight: bold; padding: 7px 10px; mso-number-format: '#,##0'; color: ${stat.netBalance > 0 ? '#15803d' : (stat.netBalance < 0 ? '#b91c1c' : '#334155')};">
          ${balancePrefix}${Number(stat.netBalance || 0).toLocaleString('vi-VN')}
        </td>
        <td align="center" bgcolor="${badgeBg}" style="border: 1px solid #94a3b8; background-color: ${badgeBg}; color: ${badgeColor}; font-weight: bold; text-align: center; padding: 7px 10px;">${statusStr}</td>
      </tr>`;
    });

    html += `
      <tr class="total-row" bgcolor="#f1f5f9">
        <td align="center" style="border: 1px solid #94a3b8; border-top: 2px solid #0f172a; border-bottom: 2px solid #0f172a; text-align: center; font-weight: bold; padding: 9px 10px;">TỔNG CỘNG</td>
        <td align="right" class="right bold" style="border: 1px solid #94a3b8; border-top: 2px solid #0f172a; border-bottom: 2px solid #0f172a; text-align: right; font-weight: bold; padding: 9px 10px; mso-number-format: '#,##0';">${sumPaid.toLocaleString('vi-VN')}</td>
        <td align="right" class="right bold" style="border: 1px solid #94a3b8; border-top: 2px solid #0f172a; border-bottom: 2px solid #0f172a; text-align: right; font-weight: bold; padding: 9px 10px; mso-number-format: '#,##0';">${sumOwed.toLocaleString('vi-VN')}</td>
        <td align="right" class="right bold" style="border: 1px solid #94a3b8; border-top: 2px solid #0f172a; border-bottom: 2px solid #0f172a; text-align: right; font-weight: bold; padding: 9px 10px; mso-number-format: '#,##0';">0</td>
        <td align="center" style="border: 1px solid #94a3b8; border-top: 2px solid #0f172a; border-bottom: 2px solid #0f172a; text-align: center; font-weight: bold; color: #15803d; padding: 9px 10px;">Cân bằng 100%</td>
      </tr>
    </table>`;

    // ================= BẢNG 3: HƯỚNG DẪN QUYẾT TOÁN TỐI ƯU =================
    html += `
    <table border="1" cellpadding="7" cellspacing="0" style="border-collapse: collapse; width: 100%; margin-bottom: 22px; border: 1.5px solid #0f172a;">
      <tr>
        <td colspan="5" class="section-header" bgcolor="#0f172a" style="background-color: #0f172a; color: #38bdf8; font-size: 11.5pt; font-weight: bold; padding: 10px 12px; border: 1.5px solid #0f172a;">
          3. LỊCH CHUYỂN KHOẢN QUYẾT TOÁN TỐI ƯU (VIETQR / VÍ MOMO)
        </td>
      </tr>
      <tr>
        <th bgcolor="#1e293b" style="background-color: #1e293b; color: #ffffff; font-weight: bold; border: 1.5px solid #475569; padding: 9px 8px; text-align: center; width: 45px;">STT</th>
        <th bgcolor="#1e293b" style="background-color: #1e293b; color: #ffffff; font-weight: bold; border: 1.5px solid #475569; padding: 9px 8px; text-align: center; width: 180px;">Người chuyển tiền</th>
        <th bgcolor="#1e293b" style="background-color: #1e293b; color: #ffffff; font-weight: bold; border: 1.5px solid #475569; padding: 9px 8px; text-align: center; width: 180px;">➔ Người nhận tiền</th>
        <th bgcolor="#1e293b" style="background-color: #1e293b; color: #ffffff; font-weight: bold; border: 1.5px solid #475569; padding: 9px 8px; text-align: center; width: 170px;">Số tiền cần chuyển (VND)</th>
        <th bgcolor="#1e293b" style="background-color: #1e293b; color: #ffffff; font-weight: bold; border: 1.5px solid #475569; padding: 9px 8px; text-align: center; width: 260px;">Thông tin Ví MoMo / STK nhận tiền</th>
      </tr>`;

    if (!summary.transactions || summary.transactions.length === 0) {
      html += `<tr><td colspan="5" align="center" style="border: 1px solid #94a3b8; text-align: center; font-weight: bold; color: #15803d; padding: 14px;">🎉 Tuyệt vời! Tất cả thành viên đã hòa vốn hoặc đã hoàn tất quyết toán.</td></tr>`;
    } else {
      summary.transactions.forEach((t, i) => {
        const toMember = t.to;
        const phone = toMember.phone || toMember.accountNo || '';
        const momoInfo = phone ? `Ví MoMo: ${phone} (${toMember.accountName || toMember.name})` : (toMember.accountName || toMember.name);
        const rowBg = (i % 2 === 0) ? '#ffffff' : '#f8fafc';

        html += `
        <tr bgcolor="${rowBg}">
          <td align="center" style="border: 1px solid #94a3b8; text-align: center; padding: 7px 8px;">${i + 1}</td>
          <td style="border: 1px solid #94a3b8; padding: 7px 10px;"><strong>${this.escapeXml(t.from ? t.from.name : '')}</strong></td>
          <td style="border: 1px solid #94a3b8; padding: 7px 10px;"><strong>${this.escapeXml(toMember.name)}</strong></td>
          <td align="right" class="right bold" style="border: 1px solid #94a3b8; text-align: right; font-weight: bold; color: #d82d8b; font-size: 11pt; padding: 7px 10px; mso-number-format: '#,##0';">
            ${Number(t.amount || 0).toLocaleString('vi-VN')}
          </td>
          <td style="border: 1px solid #94a3b8; padding: 7px 10px;">${this.escapeXml(momoInfo)}</td>
        </tr>`;
      });
    }

    html += `</table>`;

    // ================= BẢNG 4: THỐNG KÊ QUỸ NHÓM (NẾU CÓ) =================
    if (trip.fund && trip.fund.enabled) {
      const fund = trip.fund;
      const totalContributed = (fund.contributions || []).reduce((sum, c) => sum + (Number(c.amount) || 0), 0);
      const totalFundSpent = (expenses || []).filter(e => e.payerId === 'group_fund').reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
      const fundBalance = totalContributed - totalFundSpent;

      html += `
      <table border="1" cellpadding="7" cellspacing="0" style="border-collapse: collapse; width: 100%; margin-bottom: 22px; border: 1.5px solid #0f172a;">
        <tr>
          <td colspan="4" class="section-header" bgcolor="#0f172a" style="background-color: #0f172a; color: #38bdf8; font-size: 11.5pt; font-weight: bold; padding: 10px 12px; border: 1.5px solid #0f172a;">
            4. BÁO CÁO QUỸ CHUNG CỦA NHÓM (GROUP FUND)
          </td>
        </tr>
        <tr>
          <th bgcolor="#1e293b" style="background-color: #1e293b; color: #ffffff; font-weight: bold; border: 1.5px solid #475569; padding: 9px 8px; text-align: center; width: 25%;">Tổng Quỹ Đã Góp</th>
          <th bgcolor="#1e293b" style="background-color: #1e293b; color: #ffffff; font-weight: bold; border: 1.5px solid #475569; padding: 9px 8px; text-align: center; width: 25%;">Tổng Quỹ Đã Chi</th>
          <th bgcolor="#1e293b" style="background-color: #1e293b; color: #ffffff; font-weight: bold; border: 1.5px solid #475569; padding: 9px 8px; text-align: center; width: 25%;">Số Dư Quỹ Còn Lại</th>
          <th bgcolor="#1e293b" style="background-color: #1e293b; color: #ffffff; font-weight: bold; border: 1.5px solid #475569; padding: 9px 8px; text-align: center; width: 25%;">Thủ Quỹ Nhóm</th>
        </tr>
        <tr>
          <td align="center" style="border: 1px solid #94a3b8; text-align: center; font-weight: bold; color: #15803d; padding: 8px 10px;">${totalContributed.toLocaleString('vi-VN')} VND</td>
          <td align="center" style="border: 1px solid #94a3b8; text-align: center; font-weight: bold; color: #b91c1c; padding: 8px 10px;">${totalFundSpent.toLocaleString('vi-VN')} VND</td>
          <td align="center" style="border: 1px solid #94a3b8; text-align: center; font-weight: bold; color: ${fundBalance >= 0 ? '#15803d' : '#b91c1c'}; font-size: 11pt; padding: 8px 10px;">${fundBalance.toLocaleString('vi-VN')} VND</td>
          <td align="center" style="border: 1px solid #94a3b8; text-align: center; padding: 8px 10px;">${this.escapeXml(memberMap[fund.treasurerId] || 'Chưa chỉ định')}</td>
        </tr>
      </table>`;
    }

    html += `
</body>
</html>`;

    return html;
  },

  /**
   * Xuất danh sách chi tiêu ra file CSV (chuẩn UTF-8 BOM, dữ liệu thuần)
   */
  exportToCSV(trip, members, expenses, settlements) {
    const memberMap = {};
    members.forEach(m => { memberMap[m.id] = m.name; });

    const summary = window.DebtEngine ? window.DebtEngine.getTripSummary(trip, members, expenses, settlements) : { stats: {}, transactions: [], totalSpent: 0 };
    const totalSpent = summary.totalSpent || expenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);

    let csvContent = '\uFEFF'; // UTF-8 BOM để Excel đọc đúng tiếng Việt có dấu

    // Tiêu đề chuyến đi
    csvContent += `BÁO CÁO CHI TIÊU CHUYẾN ĐI: "${trip.name || 'Du lịch'}"\n`;
    csvContent += `Mã chuyến đi: #${trip.code || ''} | Ngày xuất: ${new Date().toLocaleDateString('vi-VN')}\n`;
    csvContent += `Tổng số thành viên: ${members.length} | Tổng chi tiêu: ${Number(totalSpent).toLocaleString('vi-VN')} VND\n\n`;

    // Phần 1: Danh sách các khoản chi
    csvContent += `DANH SÁCH CÁC KHOẢN CHI TIÊU\n`;
    csvContent += `STT,Ngày giờ,Nội dung chi,Danh mục,Số tiền (VND),Người chi trả,Cách chia,Người tham gia\n`;

    expenses.forEach((e, idx) => {
      const payerName = memberMap[e.payerId] || 'Không rõ';
      const dateStr = e.date ? new Date(e.date).toLocaleString('vi-VN') : '';
      const catName = this.getCategoryLabel(e.category);
      const splitTypeStr = this.getSplitTypeLabel(e.splitType);
      
      let splitMembersStr = 'Tất cả';
      if (e.splits && e.splits.length > 0) {
        splitMembersStr = e.splits
          .filter(s => s.isIncluded !== false)
          .map(s => memberMap[s.memberId] || '')
          .filter(Boolean)
          .join('; ');
      }

      const safeTitle = `"${(e.title || '').replace(/"/g, '""')}"`;
      csvContent += `${idx + 1},"${dateStr}",${safeTitle},"${catName}",${e.amount},"${payerName}","${splitTypeStr}","${splitMembersStr}"\n`;
    });

    csvContent += `\n`;

    // Phần 2: Bảng số dư ròng của từng người
    csvContent += `TỔNG KẾT THU CHI CÁ NHÂN\n`;
    csvContent += `Thành viên,Tổng đã chi (VND),Tổng phải chịu (VND),Số dư ròng (VND),Trạng thái\n`;

    members.forEach(m => {
      const stat = summary.stats[m.id] || { totalPaid: 0, totalOwed: 0, netBalance: 0 };
      const statusStr = stat.netBalance > 0 ? `Được nhận lại` : (stat.netBalance < 0 ? `Cần chuyển trả` : `Hòa vốn`);
      csvContent += `"${m.name}",${stat.totalPaid},${stat.totalOwed},${stat.netBalance},"${statusStr}"\n`;
    });

    csvContent += `\n`;

    // Phần 3: Danh sách chuyển khoản tối ưu
    csvContent += `HƯỚNG DẪN QUYẾT TOÁN (TỐI ƯU HÓA CHUYỂN KHOẢN)\n`;
    csvContent += `Người chuyển,Người nhận,Số tiền cần chuyển (VND),Tài khoản nhận tiền\n`;

    summary.transactions.forEach(t => {
      const toMember = t.to;
      const phone = toMember.phone || toMember.accountNo || '';
      const bankInfo = phone ? `MoMo - STK: ${phone} (${toMember.accountName || toMember.name})` : (toMember.accountName || toMember.name);
      csvContent += `"${t.from.name}","${toMember.name}",${t.amount},"${bankInfo}"\n`;
    });

    // Tải file CSV về máy
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `TripSplit_${trip.code || 'BaoCao'}_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    setTimeout(() => {
      if (link.parentNode) link.parentNode.removeChild(link);
      URL.revokeObjectURL(url);
    }, 600);
  },

  /**
   * Tạo hình ảnh tóm tắt chuyến đi (Infographic Summary Card)
   */
  async generateSummaryCardImage(trip, members, expenses, settlements) {
    const summary = window.DebtEngine.getTripSummary(trip, members, expenses, settlements);

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    const width = 1080;
    const height = 1500;
    canvas.width = width;
    canvas.height = height;

    const bgGrad = ctx.createLinearGradient(0, 0, 0, height);
    bgGrad.addColorStop(0, '#090d16');
    bgGrad.addColorStop(0.5, '#0f172a');
    bgGrad.addColorStop(1, '#050811');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, width, height);

    const glow1 = ctx.createRadialGradient(200, 200, 10, 200, 200, 400);
    glow1.addColorStop(0, 'rgba(16, 185, 129, 0.25)');
    glow1.addColorStop(1, 'rgba(16, 185, 129, 0)');
    ctx.fillStyle = glow1;
    ctx.beginPath();
    ctx.arc(200, 200, 400, 0, Math.PI * 2);
    ctx.fill();

    const glow2 = ctx.createRadialGradient(900, 900, 10, 900, 900, 400);
    glow2.addColorStop(0, 'rgba(245, 158, 11, 0.2)');
    glow2.addColorStop(1, 'rgba(245, 158, 11, 0)');
    ctx.fillStyle = glow2;
    ctx.beginPath();
    ctx.arc(900, 900, 400, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#10b981';
    ctx.font = 'bold 32px sans-serif';
    ctx.fillText('TRIPSPLIT • TỔNG KẾT CHI TIÊU DU LỊCH', 60, 90);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 56px sans-serif';
    ctx.fillText(trip.name || 'Chuyến Du Lịch Cùng Team', 60, 165);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '28px sans-serif';
    const dateStr = new Date().toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
    ctx.fillText(`Mã phòng: #${trip.code || 'TRIP'}  •  Ngày chốt sổ: ${dateStr}  •  ${members.length} thành viên`, 60, 215);

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(60, 250);
    ctx.lineTo(width - 60, 250);
    ctx.stroke();

    this.drawMetricCard(ctx, 60, 280, 460, 170, 'TỔNG CHI TIÊU CẢ CHUYẾN', `${Number(summary.totalSpent || 0).toLocaleString('vi-VN')} đ`, '#10b981');
    this.drawMetricCard(ctx, 560, 280, 460, 170, 'TRUNG BÌNH MỖI NGƯỜI', `${Number(summary.avgPerPerson || 0).toLocaleString('vi-VN')} đ`, '#38bdf8');

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 36px sans-serif';
    ctx.fillText('⚡ LỊCH CHUYỂN KHOẢN TỐI ƯU (VIETQR)', 60, 510);

    let startY = 550;
    if (summary.transactions.length === 0) {
      ctx.fillStyle = '#10b981';
      ctx.font = '32px sans-serif';
      ctx.fillText('🎉 Mọi người đã hòa vốn, không còn khoản nợ nào!', 60, startY + 40);
      startY += 80;
    } else {
      summary.transactions.slice(0, 5).forEach((t, i) => {
        this.drawTransferRow(ctx, 60, startY + (i * 105), width - 120, 85, t);
      });
      startY += (Math.min(summary.transactions.length, 5) * 105) + 30;
    }

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 36px sans-serif';
    ctx.fillText('👥 CHI TIÊU CHI TIẾT CÁ NHÂN', 60, startY + 30);
    startY += 70;

    members.slice(0, 5).forEach((m, idx) => {
      const stat = summary.stats[m.id] || { totalPaid: 0, totalOwed: 0, netBalance: 0 };
      this.drawMemberRow(ctx, 60, startY + (idx * 90), width - 120, 75, m, stat);
    });

    ctx.fillStyle = '#64748b';
    ctx.font = '24px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Tạo tự động bởi TripSplit - Ứng dụng quản lý chi tiêu du lịch chuẩn VietQR', width / 2, height - 50);
    ctx.textAlign = 'left';

    return canvas.toDataURL('image/png');
  },

  drawMetricCard(ctx, x, y, w, h, title, value, accentColor) {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
    this.roundRect(ctx, x, y, w, h, 20, true, false);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.lineWidth = 1.5;
    this.roundRect(ctx, x, y, w, h, 20, false, true);

    ctx.fillStyle = '#94a3b8';
    ctx.font = 'bold 22px sans-serif';
    ctx.fillText(title, x + 30, y + 50);

    ctx.fillStyle = accentColor;
    ctx.font = 'bold 42px sans-serif';
    ctx.fillText(value, x + 30, y + 120);
  },

  drawTransferRow(ctx, x, y, w, h, transaction) {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
    this.roundRect(ctx, x, y, w, h, 16, true, false);
    ctx.strokeStyle = 'rgba(245, 158, 11, 0.3)';
    ctx.lineWidth = 1;
    this.roundRect(ctx, x, y, w, h, 16, false, true);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 28px sans-serif';
    ctx.fillText(transaction.from.name, x + 25, y + 52);

    ctx.fillStyle = '#f59e0b';
    ctx.font = '24px sans-serif';
    ctx.fillText('➔ chuyển cho ➔', x + 230, y + 52);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 28px sans-serif';
    ctx.fillText(transaction.to.name, x + 440, y + 52);

    ctx.fillStyle = '#10b981';
    ctx.font = 'bold 32px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`${Number(transaction.amount).toLocaleString('vi-VN')} đ`, x + w - 25, y + 53);
    ctx.textAlign = 'left';
  },

  drawMemberRow(ctx, x, y, w, h, member, stat) {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.03)';
    this.roundRect(ctx, x, y, w, h, 14, true, false);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 26px sans-serif';
    ctx.fillText(member.name, x + 25, y + 46);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '22px sans-serif';
    ctx.fillText(`Đã trả: ${Number(stat.totalPaid).toLocaleString('vi-VN')}đ • Tiêu: ${Number(stat.totalOwed).toLocaleString('vi-VN')}đ`, x + 230, y + 46);

    const isCredit = stat.netBalance >= 0;
    ctx.fillStyle = isCredit ? '#10b981' : '#ef4444';
    ctx.font = 'bold 28px sans-serif';
    ctx.textAlign = 'right';
    const prefix = isCredit ? '+ ' : '- ';
    ctx.fillText(`${prefix}${Math.abs(stat.netBalance).toLocaleString('vi-VN')} đ`, x + w - 25, y + 48);
    ctx.textAlign = 'left';
  },

  roundRect(ctx, x, y, width, height, radius, fill, stroke) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
    if (fill) ctx.fill();
    if (stroke) ctx.stroke();
  },

  getCategoryLabel(cat) {
    const labels = {
      food: 'Ăn uống',
      transport: 'Di chuyển/Xăng xe',
      hotel: 'Khách sạn/Homestay',
      ticket: 'Vé tham quan',
      drink: 'Cafe & Bar',
      shopping: 'Mua sắm & Quà',
      entertainment: 'Giải trí',
      other: 'Khoản chi khác'
    };
    return labels[cat] || 'Khác';
  },

  getSplitTypeLabel(type) {
    const types = {
      equal: 'Chia đều',
      custom: 'Chọn lọc thành viên',
      shares: 'Theo số phần',
      exact: 'Số tiền cố định'
    };
    return types[type] || 'Chia đều';
  }
};

if (typeof window !== 'undefined') {
  window.ExportHelper = ExportHelper;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ExportHelper;
}
