# RC QUEST — เกมตามหา RC

เว็บแอปมือถือสำหรับการแข่งขัน 14 ทีม ใช้ **GitHub Pages** เป็นหน้าเว็บ และ **Supabase** เป็นฐานข้อมูล/ตัวตรวจคำตอบ/ตัวจับเวลาฝั่งเซิร์ฟเวอร์

## การทำงานของเกม

1. นักเรียนเลือกทีม แล้วกด **เริ่มเกม**
2. Supabase สุ่มลำดับสถานีทั้ง 14 จุดให้แต่ละทีมแบบไม่ซ้ำ
3. ระบบแสดง **คำถามเปิดสถานที่**
4. ตอบถูกแล้วจึงแสดงคำใบ้ พร้อมข้อความสีแดงว่า **“ให้ไปอ่านโจทย์ที่สถานที่ในคำใบ้”**
5. ที่จุด RC เว็บจะแสดงเฉพาะช่องกรอกคำตอบ ไม่แสดงโจทย์ ณ สถานที่
6. ตอบผิดต้องตอบข้อเดิมใหม่ ตอบถูกจึงไปสถานีถัดไป
7. ครบ 14 จุด ระบบถามผลรวมสุดท้าย คำตอบคือ `397,765.6`
8. เมื่อจบเกม ระบบหยุดเวลา บันทึกผล และแสดงข้อความให้กลับไปที่หอประชุมเจ้าปู่หอคำ
9. หน้า `results.html` แสดงอันดับตามเวลาที่ใช้จากน้อยไปมากและรีเฟรชทุก 15 วินาที

## ไฟล์สำคัญ

- `index.html` — หน้าเกม
- `results.html` — ตารางคะแนน
- `styles.css` — รูปแบบหน้าเว็บสำหรับโทรศัพท์
- `app.js` — การทำงานของหน้าเกม
- `config.js` — URL และ Publishable/anon key ของ Supabase
- `supabase/schema.sql` — ตาราง ข้อมูลคำถาม ฟังก์ชันตรวจคำตอบ และ RLS

## 1) ตั้งค่า Supabase

1. สร้าง Project ใหม่ใน Supabase
2. เปิด **SQL Editor**
3. คัดลอกไฟล์ `supabase/schema.sql` ทั้งหมดไปวาง แล้วกด **Run**
4. ไปที่ **Project Settings > API**
5. คัดลอก
   - Project URL
   - Publishable key หรือ anon key
6. เปิด `config.js` แล้วแทนค่า

```js
window.RC_CONFIG = {
  SUPABASE_URL: "https://xxxxxxxx.supabase.co",
  SUPABASE_ANON_KEY: "ใส่-key-ที่นี่"
};
```

> ห้ามใส่ `service_role` key ในหน้าเว็บ เพราะเป็นกุญแจสิทธิ์สูงและผู้ใช้อาจมองเห็นได้

## 2) เปลี่ยนชื่อ 14 ทีม

ค่าเริ่มต้นคือ ทีม 1 ถึง ทีม 14 แก้ใน Supabase SQL Editor เช่น

```sql
update public.game_teams set name = 'ดาวเหนือ' where id = 1;
update public.game_teams set name = 'กาแล็กซี' where id = 2;
```

## 3) นำขึ้น GitHub Pages

1. สร้าง GitHub repository ใหม่
2. อัปโหลดไฟล์ทั้งหมด โดยให้ `index.html` อยู่ที่รากของ repository
3. เปิด **Settings > Pages**
4. ใน **Build and deployment** เลือก **Deploy from a branch**
5. เลือก branch `main` และโฟลเดอร์ `/(root)` แล้วกด Save
6. เปิด URL ที่ GitHub Pages สร้างให้

หน้าเกม:

```text
https://ชื่อผู้ใช้.github.io/ชื่อ-repository/
```

ตารางอันดับ:

```text
https://ชื่อผู้ใช้.github.io/ชื่อ-repository/results.html
```

## 4) ทดสอบก่อนแข่งขันจริง

- เปิดหน้าเกมด้วยโหมดไม่ระบุตัวตน/Incognito
- ทดสอบอย่างน้อย 2 ทีมพร้อมกันจากคนละอุปกรณ์
- ตรวจว่าคำถามเปิดตอบถูกแล้วเชื่อมกับคำใบ้สถานที่หมายเลขเดียวกัน
- ตรวจว่าคำตอบ ณ จุด RC ครบ 14 ข้อรวมกันได้ `397,765.6`
- ตรวจเวลาและหน้า `results.html`

## 5) ล้างผลเพื่อเริ่มการแข่งขันใหม่

รันใน Supabase SQL Editor:

```sql
truncate table public.game_sessions;
```

จากนั้นให้นักเรียนล้างข้อมูลเว็บไซต์ในเบราว์เซอร์ หรือเปิดลิงก์ใน Incognito ใหม่

## 6) ดูสถานะทุกทีมหลังบ้าน

```sql
select
  t.id,
  t.name,
  coalesce(s.phase, 'ยังไม่เริ่ม') as phase,
  s.current_step,
  s.started_at,
  s.completed_at,
  s.wrong_count
from public.game_teams t
left join public.game_sessions s on s.team_id = t.id
order by t.id;
```

## หมายเหตุด้านความปลอดภัย

- เฉลยเก็บในตาราง `game_stations` ที่ไม่มี RLS policy สำหรับผู้ใช้ทั่วไป
- หน้าเว็บส่งคำตอบไปให้ฟังก์ชัน Supabase ตรวจ โดยไม่ได้ดาวน์โหลดเฉลยทั้งหมดลงเครื่องนักเรียน
- การผูก `device_token` ช่วยป้องกันทีมเดียวกันเปิดเกมต่อจากอีกเครื่องโดยไม่ได้ตั้งใจ
- ระบบนี้เหมาะกับกิจกรรมภายในโรงเรียน หากต้องการระบบป้องกันการโกงระดับสูง ควรเพิ่มการยืนยันตัวตนหรือ Edge Function ฝั่งเซิร์ฟเวอร์
