import http.server
import socketserver
import socket
import sys
import os
import json
import urllib.parse

PORT = int(os.environ.get('PORT', 8080))
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, 'data')
USERS_FILE = os.path.join(DATA_DIR, 'users.json')
TRIPS_FILE = os.path.join(DATA_DIR, 'trips.json')

def get_local_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(('8.8.8.8', 80))
        ip = s.getsockname()[0]
    except Exception:
        ip = '127.0.0.1'
    finally:
        s.close()
    return ip

class CustomHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # Cache control cho phát triển
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_GET(self):
        clean_path = urllib.parse.urlparse(self.path).path

        # API Lấy thông tin server mạng LAN
        if clean_path == '/api/info':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.end_headers()
            info = {
                "localIp": get_local_ip(),
                "port": PORT,
                "environment": "cloud" if os.environ.get('PORT') else "local"
            }
            self.wfile.write(json.dumps(info).encode('utf-8'))
            return
        # API Lấy danh sách tài khoản đồng bộ giữa các thiết bị
        elif clean_path == '/api/users':
            self.handle_get_json(USERS_FILE, default=[{
                "id": "usr_admin",
                "username": "admin",
                "passwordHash": "TripSplit@2026",
                "name": "Quản trị viên (Admin)",
                "phone": "0900000000",
                "bankCode": "MB",
                "accountNo": "0900000000",
                "accountName": "QUAN TRI VIEN",
                "role": "admin",
                "status": "active",
                "createdAt": "2026-01-01T00:00:00.000Z"
            }])
            return
        # API Lấy danh sách chuyến đi đồng bộ
        elif clean_path == '/api/trips':
            self.handle_get_json(TRIPS_FILE, default=[])
            return

        super().do_GET()

    def do_POST(self):
        clean_path = urllib.parse.urlparse(self.path).path

        # API Lưu danh sách tài khoản
        if clean_path == '/api/users':
            self.handle_post_json(USERS_FILE)
            return
        # API Lưu danh sách chuyến đi
        elif clean_path == '/api/trips':
            self.handle_post_json(TRIPS_FILE)
            return

        super().do_POST()

    def handle_get_json(self, file_path, default=None):
        os.makedirs(DATA_DIR, exist_ok=True)
        if not os.path.exists(file_path):
            with open(file_path, 'w', encoding='utf-8') as f:
                json.dump(default if default is not None else [], f, ensure_ascii=False, indent=2)

        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                data = f.read()
        except Exception:
            data = json.dumps(default if default is not None else [])

        self.send_response(200)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.end_headers()
        self.wfile.write(data.encode('utf-8'))

    def handle_post_json(self, file_path):
        os.makedirs(DATA_DIR, exist_ok=True)
        try:
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length).decode('utf-8')
            parsed = json.loads(body)

            # Hợp nhất thông minh cho trips để tránh mất phòng khi nhiều máy gửi cùng lúc
            if file_path == TRIPS_FILE and os.path.exists(file_path):
                try:
                    with open(file_path, 'r', encoding='utf-8') as f:
                        existing = json.load(f)
                    if isinstance(existing, list) and isinstance(parsed, list):
                        parsed = merge_trips_data(existing, parsed)
                except Exception as ex:
                    print('⚠️ Lỗi merge trips:', ex)
            elif file_path == USERS_FILE and os.path.exists(file_path):
                try:
                    with open(file_path, 'r', encoding='utf-8') as f:
                        existing = json.load(f)
                    if isinstance(existing, list) and isinstance(parsed, list):
                        parsed = merge_users_data(existing, parsed)
                except Exception as ex:
                    print('⚠️ Lỗi merge users:', ex)

            with open(file_path, 'w', encoding='utf-8') as f:
                json.dump(parsed, f, ensure_ascii=False, indent=2)
            
            target_name = os.path.basename(file_path)
            item_count = len(parsed) if isinstance(parsed, list) else 1
            print(f"✅ [DATA SYNC] Đã lưu thành công {item_count} mục vào {target_name}")

            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.end_headers()
            self.wfile.write(json.dumps({"success": True, "count": item_count}).encode('utf-8'))
        except Exception as e:
            print(f"❌ [DATA SYNC ERROR] Lỗi ghi file {file_path}: {e}")
            self.send_response(500)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.end_headers()
            self.wfile.write(json.dumps({"success": False, "error": str(e)}).encode('utf-8'))

def merge_trips_data(existing_trips, incoming_trips):
    trips_map = {t.get('code'): dict(t) for t in existing_trips if isinstance(t, dict) and t.get('code')}
    for inc in incoming_trips:
        if not isinstance(inc, dict):
            continue
        code = inc.get('code')
        if not code:
            continue

        # Nếu chuyến đi được đánh dấu xóa
        if inc.get('status') == 'deleted':
            trips_map.pop(code, None)
            continue

        if code in trips_map:
            cur = trips_map[code]
            # Giữ hostId nếu client vô tình gửi thiếu
            if not inc.get('hostId') and cur.get('hostId'):
                inc['hostId'] = cur['hostId']
            if inc.get('name', '').startswith('Chuyến đi #') and not cur.get('name', '').startswith('Chuyến đi #'):
                inc['name'] = cur['name']

            # Lấy tập hợp userId của toàn bộ thành viên hiện tại trong incoming
            all_approved_uids = {m.get('userId') for m in inc.get('members', []) if isinstance(m, dict) and m.get('userId')}

            # Hợp nhất pendingMembers (giữ các yêu cầu xin vào phòng hợp lệ)
            inc_pen_keys = {p.get('userId') or p.get('requestId') for p in inc.get('pendingMembers', []) if isinstance(p, dict)}
            for p in cur.get('pendingMembers', []):
                if isinstance(p, dict):
                    p_uid = p.get('userId')
                    p_key = p_uid or p.get('requestId')
                    if p_uid and p_uid in all_approved_uids:
                        continue
                    if p_key and p_key not in inc_pen_keys:
                        inc.setdefault('pendingMembers', []).append(p)
                        inc_pen_keys.add(p_key)

            inc['pendingMembers'] = [
                p for p in inc.get('pendingMembers', [])
                if isinstance(p, dict) and p.get('userId') not in all_approved_uids
            ]

            # CHÚ Ý: members và expenses nhận trực tiếp từ inc để cho phép xóa thành viên, rời nhóm, xóa chi tiêu
            trips_map[code] = inc
        else:
            trips_map[code] = inc
    return [t for t in trips_map.values() if isinstance(t, dict) and t.get('status') != 'deleted']

def merge_users_data(existing_users, incoming_users):
    users_map = {}
    for u in existing_users:
        if isinstance(u, dict) and u.get('id'):
            users_map[u['id']] = dict(u)

    uname_to_id = {}
    for uid, u in users_map.items():
        uname = u.get('username')
        if uname:
            uname_to_id[uname.lower()] = uid

    for inc in incoming_users:
        if not isinstance(inc, dict):
            continue
        uid = inc.get('id')
        uname = inc.get('username', '').lower() if inc.get('username') else None

        target_id = uid if uid in users_map else (uname_to_id.get(uname) if uname else None)

        # Xóa tài khoản nếu nhận trạng thái deleted
        if inc.get('status') == 'deleted':
            if target_id and target_id in users_map:
                del users_map[target_id]
            continue

        if target_id and target_id in users_map:
            cur = users_map[target_id]
            for k, v in inc.items():
                if v is not None and v != '':
                    cur[k] = v
        else:
            if uid:
                users_map[uid] = dict(inc)
                if uname:
                    uname_to_id[uname] = uid

    return [u for u in users_map.values() if isinstance(u, dict) and u.get('status') != 'deleted']

def main():
    os.chdir(BASE_DIR)
    local_ip = get_local_ip()
    url = f"http://{local_ip}:{PORT}"
    localhost_url = f"http://localhost:{PORT}"

    print("=" * 60)
    print(" 🚀 TRIPSPLIT - SỔ CHI TIÊU DU LỊCH ĐANG CHẠY (CÓ ĐỒNG BỘ DỮ LIỆU)!")
    print("=" * 60)
    print(f" • Mở trên máy tính này: {localhost_url}")
    print(f" • Mở trên ĐIỆN THOẠI (cùng Wi-Fi):")
    print(f"   👉  {url}")
    print("=" * 60)
    print(" Nhấn Ctrl + C để dừng máy chủ.")
    print()

    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("", PORT), CustomHandler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nĐã dừng máy chủ TripSplit. Tạm biệt!")
            sys.exit(0)

if __name__ == '__main__':
    main()
