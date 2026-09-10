import http.server
import socketserver
import socket
import sys
import os
import json
import urllib.parse

try:
    import psycopg2
    from psycopg2.extras import Json
    HAS_POSTGRES = True
except ImportError:
    HAS_POSTGRES = False

PORT = int(os.environ.get('PORT', 8080))
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, 'data')
USERS_FILE = os.path.join(DATA_DIR, 'users.json')
TRIPS_FILE = os.path.join(DATA_DIR, 'trips.json')

_db_conn = None

def get_db_connection():
    global _db_conn
    db_url = os.environ.get('DATABASE_URL') or os.environ.get('SUPABASE_DB_URL')
    if not db_url or not HAS_POSTGRES:
        return None
    
    try:
        if _db_conn is not None and not _db_conn.closed:
            with _db_conn.cursor() as cur:
                cur.execute("SELECT 1;")
            return _db_conn
    except Exception:
        _db_conn = None

    try:
        clean_url = db_url.strip()
        if clean_url.startswith('postgres://'):
            clean_url = 'postgresql://' + clean_url[len('postgres://'):]
        _db_conn = psycopg2.connect(clean_url, connect_timeout=10)
        _db_conn.autocommit = True
        return _db_conn
    except Exception as ex:
        print(f"⚠️ [DATABASE] Lỗi kết nối PostgreSQL/Supabase: {ex}")
        _db_conn = None
        return None

def init_database():
    conn = get_db_connection()
    if not conn:
        print("ℹ️ [DATABASE] Không có DATABASE_URL hoặc chưa có kết nối. Hệ thống dùng tệp JSON cục bộ.")
        return
    try:
        with conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS trips (
                    code VARCHAR(100) PRIMARY KEY,
                    name VARCHAR(255),
                    data JSONB NOT NULL,
                    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                );
                CREATE TABLE IF NOT EXISTS users (
                    id VARCHAR(100) PRIMARY KEY,
                    username VARCHAR(100),
                    data JSONB NOT NULL,
                    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                );
            """)

            cur.execute("SELECT COUNT(*) FROM users;")
            if cur.fetchone()[0] == 0 and os.path.exists(USERS_FILE):
                try:
                    with open(USERS_FILE, 'r', encoding='utf-8') as f:
                        init_users = json.load(f)
                    if isinstance(init_users, list):
                        for u in init_users:
                            uid = u.get('id')
                            uname = u.get('username')
                            if uid:
                                cur.execute(
                                    "INSERT INTO users (id, username, data) VALUES (%s, %s, %s) ON CONFLICT (id) DO NOTHING;",
                                    (uid, uname, Json(u))
                                )
                        print(f"🌱 [DATABASE SEED] Đã chuyển thành công {len(init_users)} tài khoản ban đầu vào Supabase!")
                except Exception as ex:
                    print(f"⚠️ [DATABASE SEED] Lỗi import users: {ex}")

            cur.execute("SELECT COUNT(*) FROM trips;")
            if cur.fetchone()[0] == 0 and os.path.exists(TRIPS_FILE):
                try:
                    with open(TRIPS_FILE, 'r', encoding='utf-8') as f:
                        init_trips = json.load(f)
                    if isinstance(init_trips, list):
                        for t in init_trips:
                            code = t.get('code')
                            name = t.get('name')
                            if code:
                                cur.execute(
                                    "INSERT INTO trips (code, name, data) VALUES (%s, %s, %s) ON CONFLICT (code) DO NOTHING;",
                                    (code, name, Json(t))
                                )
                        print(f"🌱 [DATABASE SEED] Đã chuyển thành công {len(init_trips)} chuyến đi ban đầu vào Supabase!")
                except Exception as ex:
                    print(f"⚠️ [DATABASE SEED] Lỗi import trips: {ex}")

        print("🎉 [DATABASE] Đã kết nối Supabase thành công và sẵn sàng lưu trữ đám mây vĩnh viễn!")
    except Exception as ex:
        print(f"⚠️ [DATABASE] Lỗi khởi tạo bảng: {ex}")

def get_db_users():
    conn = get_db_connection()
    if not conn:
        return None
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT data FROM users ORDER BY updated_at ASC;")
            rows = cur.fetchall()
            return [r[0] for r in rows if r and r[0]]
    except Exception as ex:
        print(f"⚠️ [DB GET USERS ERROR]: {ex}")
        return None

def get_db_trips():
    conn = get_db_connection()
    if not conn:
        return None
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT data FROM trips ORDER BY updated_at ASC;")
            rows = cur.fetchall()
            return [r[0] for r in rows if r and r[0]]
    except Exception as ex:
        print(f"⚠️ [DB GET TRIPS ERROR]: {ex}")
        return None

def save_db_users(users_list):
    conn = get_db_connection()
    if not conn or not isinstance(users_list, list):
        return False
    try:
        with conn.cursor() as cur:
            for u in users_list:
                if not isinstance(u, dict):
                    continue
                uid = u.get('id')
                uname = u.get('username')
                status = u.get('status')
                if uid:
                    if status == 'deleted':
                        cur.execute("DELETE FROM users WHERE id = %s;", (uid,))
                    else:
                        cur.execute("""
                            INSERT INTO users (id, username, data, updated_at)
                            VALUES (%s, %s, %s, CURRENT_TIMESTAMP)
                            ON CONFLICT (id) DO UPDATE
                            SET data = EXCLUDED.data, username = EXCLUDED.username, updated_at = CURRENT_TIMESTAMP;
                        """, (uid, uname, Json(u)))
        return True
    except Exception as ex:
        print(f"⚠️ [DB SAVE USERS ERROR]: {ex}")
        return False

def save_db_trips(trips_list):
    conn = get_db_connection()
    if not conn or not isinstance(trips_list, list):
        return False
    try:
        with conn.cursor() as cur:
            active_codes = set()
            for t in trips_list:
                if not isinstance(t, dict):
                    continue
                code = t.get('code')
                name = t.get('name')
                if code:
                    active_codes.add(code)
                    cur.execute("""
                        INSERT INTO trips (code, name, data, updated_at)
                        VALUES (%s, %s, %s, CURRENT_TIMESTAMP)
                        ON CONFLICT (code) DO UPDATE
                        SET data = EXCLUDED.data, name = EXCLUDED.name, updated_at = CURRENT_TIMESTAMP;
                    """, (code, name, Json(t)))
            if active_codes:
                cur.execute("DELETE FROM trips WHERE code NOT IN %s;", (tuple(active_codes),))
            elif len(trips_list) == 0:
                cur.execute("DELETE FROM trips;")
        return True
    except Exception as ex:
        print(f"⚠️ [DB SAVE TRIPS ERROR]: {ex}")
        return False

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

        if clean_path == '/api/info':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.end_headers()
            info = {
                "localIp": get_local_ip(),
                "port": PORT,
                "environment": "cloud" if os.environ.get('PORT') else "local",
                "database": "supabase" if (os.environ.get('DATABASE_URL') or os.environ.get('SUPABASE_DB_URL')) else "local_json"
            }
            self.wfile.write(json.dumps(info).encode('utf-8'))
            return
        elif clean_path == '/api/users':
            self.handle_get_json(USERS_FILE, default=[{
                "id": "usr_admin",
                "username": "admin",
                "passwordHash": "Letuananh1996",
                "name": "Hương, T.Anh",
                "phone": "0900000000",
                "bankCode": "MOMO",
                "accountNo": "0900000000",
                "accountName": "HUONG VA TUAN ANH",
                "role": "admin",
                "status": "active",
                "createdAt": "2026-01-01T00:00:00.000Z"
            }])
            return
        elif clean_path == '/api/trips':
            self.handle_get_json(TRIPS_FILE, default=[])
            return

        super().do_GET()

    def do_POST(self):
        clean_path = urllib.parse.urlparse(self.path).path

        if clean_path == '/api/users':
            self.handle_post_json(USERS_FILE)
            return
        elif clean_path == '/api/trips':
            self.handle_post_json(TRIPS_FILE)
            return

        super().do_POST()

    def handle_get_json(self, file_path, default=None):
        if file_path == USERS_FILE:
            db_data = get_db_users()
            if db_data is not None and len(db_data) > 0:
                try:
                    os.makedirs(DATA_DIR, exist_ok=True)
                    with open(file_path, 'w', encoding='utf-8') as f:
                        json.dump(db_data, f, ensure_ascii=False, indent=2)
                except Exception:
                    pass
                self.send_response(200)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.end_headers()
                self.wfile.write(json.dumps(db_data, ensure_ascii=False).encode('utf-8'))
                return

        elif file_path == TRIPS_FILE:
            db_data = get_db_trips()
            if db_data is not None and len(db_data) > 0:
                try:
                    os.makedirs(DATA_DIR, exist_ok=True)
                    with open(file_path, 'w', encoding='utf-8') as f:
                        json.dump(db_data, f, ensure_ascii=False, indent=2)
                except Exception:
                    pass
                self.send_response(200)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.end_headers()
                self.wfile.write(json.dumps(db_data, ensure_ascii=False).encode('utf-8'))
                return

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

            existing = None
            if file_path == TRIPS_FILE:
                existing = get_db_trips()
                if existing is None and os.path.exists(file_path):
                    try:
                        with open(file_path, 'r', encoding='utf-8') as f:
                            existing = json.load(f)
                    except Exception:
                        pass
                if isinstance(existing, list) and isinstance(parsed, list):
                    parsed = merge_trips_data(existing, parsed)
                
                save_db_trips(parsed)

            elif file_path == USERS_FILE:
                existing = get_db_users()
                if existing is None and os.path.exists(file_path):
                    try:
                        with open(file_path, 'r', encoding='utf-8') as f:
                            existing = json.load(f)
                    except Exception:
                        pass
                if isinstance(existing, list) and isinstance(parsed, list):
                    parsed = merge_users_data(existing, parsed)

                save_db_users(parsed)

            with open(file_path, 'w', encoding='utf-8') as f:
                json.dump(parsed, f, ensure_ascii=False, indent=2)
            
            target_name = os.path.basename(file_path)
            item_count = len(parsed) if isinstance(parsed, list) else 1
            print(f"✅ [DATA SYNC] Đã lưu thành công {item_count} mục vào {target_name} và Database!")

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
    init_database()
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
