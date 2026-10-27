"""临时接口验证脚本：python _verify_api.py（运行后删除）"""
import io

from PIL import Image

from app import create_app

app = create_app()
c = app.test_client()

# 登录种子用户（登录标识为 username，见 6.2 节）
lr = c.post("/api/auth/login", json={"username": "xiaoming", "password": "123456"})
lj = lr.get_json()
token = lj["data"]["access_token"]
H = {"Authorization": "Bearer " + token}
print("1 login:", lr.status_code, lj["msg"])

# 生成一张测试图片
buf = io.BytesIO()
Image.new("RGB", (800, 600), (70, 130, 200)).save(buf, "JPEG")
buf.seek(0)

# 上传
ur = c.post("/api/upload", data={"file": (buf, "test.jpg")}, headers=H,
            content_type="multipart/form-data")
uj = ur.get_json()
print("2 upload:", ur.status_code, uj["msg"], uj["data"] if uj["data"] else uj["msg"])
url = uj["data"]["url"]

# 上传非法类型
ur2 = c.post("/api/upload", data={"file": (io.BytesIO(b"hello"), "a.txt")},
             headers=H, content_type="multipart/form-data")
print("3 upload bad ext:", ur2.status_code, ur2.get_json()["code"])

# 静态访问
sr = c.get(url)
print("4 static file:", sr.status_code, sr.content_type)
# 必须显式关闭响应：test_client 不关闭时文件句柄一直持有，
# 后面「删除作品连带删文件」在 Windows 上会因文件被占用而静默失败（第 13 步会误报 200）
sr.close()

# 创建作品
cr = c.post("/api/works", json={"title": "接口测试作品", "type": "ai", "image_path": url}, headers=H)
cj = cr.get_json()
print("5 create work:", cr.status_code, cj["data"]["id"])
wid = cj["data"]["id"]

# 创建非法类型
cr2 = c.post("/api/works", json={"title": "x", "type": "hack", "image_path": url}, headers=H)
print("6 bad type:", cr2.status_code, cr2.get_json()["code"])

# 作品列表
lr_list = c.get("/api/works?page=1&size=5", headers=H)
print("7 list works:", lr_list.status_code, "total=", lr_list.get_json()["data"]["total"])

# 详情
dr = c.get(f"/api/works/{wid}", headers=H)
print("8 detail:", dr.status_code, dr.get_json()["data"]["title"])

# records
rr = c.get(f"/api/works/{wid}/records", headers=H)
print("9 records:", rr.status_code, len(rr.get_json()["data"]["items"]))

# stickers
sr_ = c.get("/api/stickers", headers=H)
print("10 stickers:", sr_.status_code, len(sr_.get_json()["data"]["items"]))

# 未登录访问作品列表
nr = c.get("/api/works")
print("11 no-auth works:", nr.status_code, nr.get_json()["code"])

# 删除作品（连带删除文件）
dr2 = c.delete(f"/api/works/{wid}", headers=H)
print("12 delete work:", dr2.status_code, dr2.get_json()["msg"])
# 文件应已被删除
fr = c.get(url)
print("13 file deleted:", fr.status_code)