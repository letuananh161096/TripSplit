/**
 * Module Thuật toán Tối ưu hóa Nợ & Thống kê Tài chính
 */
const DebtEngine = {
  /**
   * Tính toán số dư ròng (Net Balance) của từng thành viên
   * @param {Array} members - Danh sách thành viên [{id, name, ...}]
   * @param {Array} expenses - Danh sách các khoản chi
   * @param {Array} settlements - Danh sách các khoản đã thanh toán trả nợ trước đó
   */
  /**
   * Tính toán số dư ròng (Net Balance) của từng thành viên kèm Quỹ Nhóm (Thủ quỹ)
   * @param {Array} members - Danh sách thành viên [{id, name, ...}]
   * @param {Array} expenses - Danh sách các khoản chi
   * @param {Array} settlements - Danh sách các khoản đã thanh toán trả nợ trước đó
   * @param {Object} fund - Cấu hình và dữ liệu Quỹ Nhóm { treasurerId, contributions: [...] }
   */
  calculateBalances(members, expenses = [], settlements = [], fund = null) {
    const balances = {};
    const stats = {};

    members.forEach(m => {
      balances[m.id] = 0;
      stats[m.id] = {
        member: m,
        totalPaid: 0,
        totalOwed: 0,
        netBalance: 0,
        fundContributed: 0
      };
    });

    // 1. Phân bổ các khoản đóng góp Quỹ Nhóm (Fund Contributions) - CHỈ KHI QUỸ ĐANG BẬT
    let totalFundCollected = 0;
    const isFundEnabled = Boolean(fund && fund.enabled);
    const contributions = (isFundEnabled && fund.contributions) ? fund.contributions : [];
    contributions.forEach(c => {
      const amt = Number(c.amount) || 0;
      if (amt > 0 && balances[c.memberId] !== undefined) {
        balances[c.memberId] += amt;
        stats[c.memberId].totalPaid += amt;
        stats[c.memberId].fundContributed += amt;
        totalFundCollected += amt;
      }
    });

    // 2. Phân bổ các khoản chi (Expenses)
    let totalFundSpent = 0;
    expenses.forEach(exp => {
      const amount = Number(exp.amount) || 0;
      if (amount <= 0) return;

      const payerId = exp.payerId;
      const isFromFund = (payerId === 'group_fund');

      if (isFromFund) {
        // Chi trả từ Quỹ chung do Thủ quỹ giữ
        totalFundSpent += amount;
      } else if (balances[payerId] !== undefined) {
        // Chi trả bằng tiền túi cá nhân
        balances[payerId] += amount;
        stats[payerId].totalPaid += amount;
      }

      // Tính phần chia thụ hưởng cho từng người
      const splits = this.resolveSplits(exp, members);
      splits.forEach(split => {
        if (balances[split.memberId] !== undefined) {
          balances[split.memberId] -= split.amount;
          stats[split.memberId].totalOwed += split.amount;
        }
      });
    });

    // 3. Xử lý số dư Quỹ Nhóm của Thủ Quỹ (Treasurer Cash Holding)
    // Chỉ tính khi Quỹ nhóm được kích hoạt
    const remainingFund = totalFundCollected - totalFundSpent;
    const treasurerId = fund && fund.treasurerId ? fund.treasurerId : (members[0] ? members[0].id : null);

    if (isFundEnabled && treasurerId && balances[treasurerId] !== undefined && totalFundCollected > 0) {
      balances[treasurerId] -= remainingFund;
    }

    // 4. Bù trừ các khoản đã thanh toán chuyển khoản trước đó (Settlements)
    settlements.forEach(settle => {
      const amount = Number(settle.amount) || 0;
      if (amount <= 0) return;

      if (balances[settle.fromMemberId] !== undefined) {
        balances[settle.fromMemberId] += amount;
      }
      if (balances[settle.toMemberId] !== undefined) {
        balances[settle.toMemberId] -= amount;
      }
    });

    // Cập nhật netBalance
    members.forEach(m => {
      stats[m.id].netBalance = Math.round(balances[m.id]);
    });

    const fundSummary = {
      enabled: isFundEnabled,
      totalCollected: totalFundCollected,
      totalSpent: totalFundSpent,
      remaining: remainingFund,
      treasurerId: treasurerId
    };

    return { balances, stats, fundSummary };
  },

  /**
   * Phân bổ chi tiết số tiền mỗi người phải chịu trong một khoản chi
   */
  resolveSplits(exp, members) {
    const totalAmount = Number(exp.amount) || 0;
    const splitType = exp.splitType || 'equal';
    const rawSplits = exp.splits || [];
    const results = [];

    if (splitType === 'equal') {
      // Chia đều cho những người được chọn (hoặc tất cả nếu không chọn lọc)
      const activeMemberIds = rawSplits.length > 0
        ? rawSplits.filter(s => s.isIncluded).map(s => s.memberId)
        : members.map(m => m.id);

      const count = activeMemberIds.length;
      if (count > 0) {
        const perPerson = Math.floor(totalAmount / count);
        let remainder = totalAmount - (perPerson * count);

        activeMemberIds.forEach((mId, index) => {
          // Bù số dư lẻ cho người đầu tiên
          const allocated = perPerson + (index === 0 ? remainder : 0);
          results.push({ memberId: mId, amount: allocated });
        });
      }
    } else if (splitType === 'exact') {
      // Chia theo số tiền cố định
      rawSplits.forEach(s => {
        results.push({ memberId: s.memberId, amount: Number(s.amount) || 0 });
      });
    } else if (splitType === 'shares') {
      // Chia theo số phần / suất (người lớn 1, trẻ em 0.5...)
      let totalShares = 0;
      rawSplits.forEach(s => {
        if (s.isIncluded) totalShares += Number(s.shares) || 1;
      });

      if (totalShares > 0) {
        let allocatedSum = 0;
        const validSplits = rawSplits.filter(s => s.isIncluded);
        validSplits.forEach((s, idx) => {
          const share = Number(s.shares) || 1;
          const portion = idx === validSplits.length - 1
            ? totalAmount - allocatedSum
            : Math.round((totalAmount * share) / totalShares);
          allocatedSum += portion;
          results.push({ memberId: s.memberId, amount: portion });
        });
      }
    } else {
      // Mặc định chia đều
      const perPerson = Math.floor(totalAmount / (members.length || 1));
      members.forEach(m => results.push({ memberId: m.id, amount: perPerson }));
    }

    return results;
  },

  /**
   * Thuật toán Tối ưu hóa Nợ (Debt Minimization - Greedy Match)
   * Biến ma trận nợ nần phức tạp thành số lần chuyển khoản ít nhất có thể (tối đa N - 1)
   */
  simplifyDebts(members, balances) {
    const memberMap = {};
    members.forEach(m => { memberMap[m.id] = m; });

    const debtors = [];  // Người nợ (balance < 0)
    const creditors = []; // Người được nhận (balance > 0)

    for (const [mId, balance] of Object.entries(balances)) {
      const val = Math.round(balance);
      if (val < -1) {
        debtors.push({ memberId: mId, amount: Math.abs(val) });
      } else if (val > 1) {
        creditors.push({ memberId: mId, amount: val });
      }
    }

    // Sắp xếp giảm dần theo số tiền
    debtors.sort((a, b) => b.amount - a.amount);
    creditors.sort((a, b) => b.amount - a.amount);

    const transactions = [];
    let dIdx = 0;
    let cIdx = 0;

    while (dIdx < debtors.length && cIdx < creditors.length) {
      const debtor = debtors[dIdx];
      const creditor = creditors[cIdx];

      const settleAmount = Math.min(debtor.amount, creditor.amount);

      if (settleAmount >= 1) {
        transactions.push({
          from: memberMap[debtor.memberId],
          to: memberMap[creditor.memberId],
          amount: Math.round(settleAmount)
        });
      }

      debtor.amount -= settleAmount;
      creditor.amount -= settleAmount;

      if (debtor.amount < 1) dIdx++;
      if (creditor.amount < 1) cIdx++;
    }

    return transactions;
  },

  /**
   * Thống kê tổng hợp chuyến đi
   */
  getTripSummary(trip, members, expenses, settlements) {
    const fund = trip ? trip.fund : null;
    const { balances, stats, fundSummary } = this.calculateBalances(members, expenses, settlements, fund);
    const transactions = this.simplifyDebts(members, balances);

    const totalSpent = expenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
    const avgPerPerson = members.length > 0 ? Math.round(totalSpent / members.length) : 0;

    // Phân loại theo danh mục
    const categoryTotals = {};
    expenses.forEach(e => {
      const cat = e.category || 'other';
      categoryTotals[cat] = (categoryTotals[cat] || 0) + (Number(e.amount) || 0);
    });

    return {
      totalSpent,
      avgPerPerson,
      categoryTotals,
      balances,
      stats,
      transactions,
      fundSummary
    };
  }
};

window.DebtEngine = DebtEngine;
