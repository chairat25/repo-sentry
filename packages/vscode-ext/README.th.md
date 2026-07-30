# repo-sentry

แจ้งเตือนเมื่อ git repository ตามหลัง remote (ต้นทางไกล) — ก่อน commit
ก่อน push ก่อน boot service และระหว่างที่กำลังทำงานอยู่

ออกแบบมาสำหรับทีมที่นักพัฒนาหลายคนใช้ branch เดียวกันข้าม repository หลายตัว

## สิ่งที่มันทำ

| จังหวะ | สิ่งที่เกิดขึ้น |
|---|---|
| เปิด workspace | เช็คทุก repository ทันที ตัวไหนตามหลังจะเด้ง modal |
| ระหว่างทำงาน | poll ทุก 60 วินาที มีคน push มาก็เด้ง modal |
| ก่อน commit | `pre-commit` hook ปฏิเสธการ commit บอกให้ pull ก่อน |
| ก่อน push | `pre-push` hook หยุด push ก่อนที่ remote จะ reject |
| ก่อน boot | `guard` ไม่ยอมให้ service เริ่มทำงานบน checkout ที่เก่าแล้ว พร้อมอธิบายเหตุผล |

ไม่ต้อง config ใดๆ ในการเริ่มต้น — เปิด workspace แล้วทุก git repository ข้างใน
(ลึกไม่เกิน 2 ชั้นโฟลเดอร์) จะถูกเฝ้าดูอัตโนมัติ status bar แสดงจำนวนไว้ คลิกดู
ได้ว่า repo ไหนบ้าง และ pull ตัวที่ตามหลังได้เลย

## อยากให้เตือนก่อน commit หรือ push ที่อาจมีปัญหามั้ย?

extension เพียงอย่างเดียวก็เตือนใน editor ให้อยู่แล้ว แต่ถ้าอยากให้ **git เอง
ปฏิเสธ** การ `commit` หรือ `push` ตอน repo ตามหลังอยู่ — คือเช็ค "เอ๊ะ ลืม pull
รึเปล่านะ" — ให้ติดตั้ง CLI ตัวช่วยแล้วรันคำสั่งเดียว:

```bash
repo-sentry install-hooks --path /path/to/your/workspace
```

คำสั่งนี้จะเขียน `pre-commit` และ `pre-push` hook ลงไปในทุก repository ใต้
path นั้น หลังจากนี้:

```
$ git commit -m "fix bug"
✗ repo-sentry: billing-service — dev is 3 commits behind origin/dev

  Pull before committing:
    git pull --rebase

  Skip this check:
    git commit --no-verify
```

ตอน `git push` ก็เหมือนกัน แค่เปลี่ยนข้อความเป็น "push ของคุณจะโดน reject" —
นี่คือตัวที่หยุดปัญหา "push โดน reject แล้วต้องมา reset แล้วมา stash" ตั้งแต่
ต้นตอเลย

ยังไม่มี CLI? โหลด `repo-sentry.cjs` จาก
[หน้า Releases](https://github.com/chairat25/repo-sentry/releases) แล้ว:

```bash
chmod +x repo-sentry.cjs
sudo mv repo-sentry.cjs /usr/local/bin/repo-sentry
```

หรือสั่ง **repo-sentry: Install Git Hooks** จาก command palette ได้เลยเมื่อมี
CLI อยู่ใน PATH แล้ว

## Boot guard

`repo-sentry install-guards --yes` ต่อสายเช็คเดียวกันเข้าไปใน run script ของ
คุณ ให้ service ปฏิเสธการเริ่มทำงานบน checkout ที่เก่าแล้ว พอเกิดเหตุการณ์นี้
extension จะเด้ง modal พร้อมปุ่ม **Pull now** — เพราะ boot บน checkout เก่าจะ
ทำให้ ORM ที่ sync schema ลบ column ที่เพื่อนเพิ่งเพิ่มทิ้ง ข้อมูลตรงนั้นกู้
คืนไม่ได้

ข้ามการ guard ครั้งเดียวด้วย `REPO_SENTRY_SKIP=1`

## การเตือน

พอ repository ตามหลังอยู่ modal จะบังกลางหน้าจอ:

```
⛔  PULL FIRST — billing-service is 3 commits behind

    billing-service (dev)  ↓3

    If you keep working without pulling:
      •  your next push will be rejected
      •  starting a service may drop columns a teammate just added,
         and that data cannot be recovered

              [ Pull now ]  [ Snooze 30m ]  [ Details ]
```

ตั้งใจทำเป็น modal เพราะ toast มุมจอมักถูกมองข้าม ซึ่งเป็นสาเหตุที่ปัญหา
checkout เก่ายังเกิดซ้ำอยู่เรื่อยๆ ปรับ `repoSentry.alertStyle` เป็น
`notification` ถ้าอยากได้แบบเบาลง

กดปิดโดยไม่ pull จะเด้งเตือนซ้ำทุก 15 นาที เพราะอันตรายยังไม่หายไปไหน ใส่
`repoSentry.remindEveryMinutes` เป็น `0` ถ้าอยากให้เตือนแค่ครั้งเดียวต่อการ
เปลี่ยนแปลง

การเตือนจะเกิดตอน state เปลี่ยนเท่านั้น ไม่ใช่ทุก poll และจะหยุด poll ตอน
IDE ไม่ได้ focus — modal เลยไม่มีทางเด้งทับโปรแกรมอื่น และไม่เด้งซ้ำสำหรับ
commit ชุดเดียวกัน

## มีไฟล์แก้ค้างอยู่? มันจะถามก่อน

`git pull --ff-only` (คำสั่งที่ปุ่ม **Pull now** ทุกที่รันอยู่) ปฏิเสธเอง
อัตโนมัติอยู่แล้ว ไม่มี force เด็ดขาด ถ้ามีอะไรจะมาทับไฟล์ที่คุณแก้ค้างอยู่
สิ่งเดียวที่มันไม่เตือนคือไฟล์แก้ค้างที่ไม่ได้ชนกับอะไรเลย ซึ่งจะ pull ผ่าน
ไปเงียบๆ — ก่อน pull ทุกครั้ง repo-sentry จะเช็คจุดนี้แล้วถามก่อน:

```
⚠  billing-service has uncommitted changes

     Stash & Pull  —  เก็บงานไว้ก่อน แล้วค่อย pull กู้คืนด้วย
                       "git stash pop"
     Pull Anyway   —  pull ตรงๆ เลย git ยังเช็คชนให้เหมือนเดิม
```

repo ที่สะอาดจะไม่เห็น dialog นี้เลย — pull ตรงไปเลย

## ตั้งค่า

| Setting | ค่าเริ่มต้น | หน้าที่ |
|---|---|---|
| `repoSentry.alertStyle` | `modal` | `modal` หรือ `notification` |
| `repoSentry.remindEveryMinutes` | `15` | เตือนซ้ำระหว่างที่ยังตามหลังอยู่ ใส่ `0` เพื่อปิด |
| `repoSentry.pollIntervalSeconds` | `60` | เช็คถี่แค่ไหน |
| `repoSentry.maxDepth` | `2` | ความลึกโฟลเดอร์ที่จะสแกนหา repository |
| `repoSentry.exclude` | `[]` | glob pattern ของ path repository ที่จะไม่สนใจ |
| `repoSentry.notifyOnOpen` | `true` | เตือนทันทีที่เปิด workspace |
| `repoSentry.snoozeMinutes` | `30` | ระยะเวลา snooze |
| `repoSentry.fetchTimeoutMs` | `15000` | เวลาที่ให้ในการ fetch แต่ละครั้ง |

## หมายเหตุ

- repository ที่ remote เข้าไม่ถึงจะขึ้นแค่ใน status bar เท่านั้น ไม่ block
  commit และไม่เด้ง popup เลย — ทำงานตอนออฟไลน์ได้ปกติ
- pull แบบ fast-forward เท่านั้น branch ที่แยกทางกันแล้วจะแค่รายงาน ไม่ auto-merge ให้
- แจ้งเตือนจะเกิดตอน state เปลี่ยนเท่านั้น ไม่ใช่ทุก poll

เอกสารฉบับเต็ม: [English](https://github.com/chairat25/repo-sentry#readme) ·
[ภาษาไทย](https://github.com/chairat25/repo-sentry/blob/main/README.th.md)
