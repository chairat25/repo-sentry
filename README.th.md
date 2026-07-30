# repo-sentry

[English](README.md) | **[ภาษาไทย](README.th.md)**

แจ้งเตือนเมื่อ git repository ตามหลัง remote (ต้นทางไกล) — ก่อน commit (บันทึก)
ก่อน push (ส่งขึ้น) ก่อน boot (เริ่ม) service และระหว่างที่กำลังทำงานอยู่

ออกแบบมาสำหรับทีมที่นักพัฒนาหลายคนใช้ branch (สาขา) เดียวกันข้าม repository
หลายตัวพร้อมกัน มีไว้กัน 2 เหตุการณ์นี้โดยเฉพาะ

- **Push ชนกัน** — คนหนึ่ง push แล้ว อีกคนที่ยังไม่ pull (ดึงลง) มา commit
  บนฐานเก่า พอ push ก็โดน reject (ปฏิเสธ) ต้องมาแก้ด้วย `git reset`/`stash`
  ซึ่งมักทำให้ working tree (พื้นที่ทำงาน) รกและสับสน
- **ข้อมูลหายเงียบ** — มีคนเพิ่ม column (คอลัมน์) ใหม่ในฐานข้อมูล แล้วเพื่อนที่ยังไม่
  pull ไป boot service ที่ใช้ ORM แบบ sync schema (TypeORM `synchronize: true`,
  Sequelize `sync({ alter: true })` ฯลฯ) — ORM จะลบ column ทิ้งให้ตรงกับ
  entity เก่าในเครื่องตัวเอง ข้อมูลในนั้นหายและกู้คืนไม่ได้

| จังหวะ | สิ่งที่เกิดขึ้น |
|---|---|
| เปิด workspace | เช็คทุก repository ทันที ตัวไหนตามหลังจะเด้ง modal (กล่องข้อความ) |
| ระหว่างทำงาน | poll (สำรวจ) ทุก 60 วินาที มีคน push มาก็เด้ง modal |
| ก่อน commit | `pre-commit` hook (ตัวดัก) ปฏิเสธการ commit บอกให้ pull ก่อน |
| ก่อน push | `pre-push` hook หยุด push ก่อนที่ remote จะ reject |
| ก่อน boot | `guard` (ตัวกั้น) ไม่ยอมให้ service เริ่มทำงานบน checkout ที่เก่าแล้ว |

ไม่ต้อง config (ตั้งค่า) ใดๆ ในการเริ่มต้น — เปิด workspace แล้วทุก git
repository ข้างในนั้น (ลึกไม่เกิน 2 ชั้นโฟลเดอร์) จะถูกเฝ้าดูอัตโนมัติ

---

## สารบัญ

- [เริ่มต้นแบบเร็ว](#เริ่มต้นแบบเร็ว)
- [1. ติดตั้ง extension ใน editor](#1-ติดตั้ง-extension-ใน-editor)
- [2. ติดตั้ง CLI](#2-ติดตั้ง-cli)
- [3. เสริม: git hooks (ป้องกันตอน commit / push)](#3-เสริม-git-hooks-ป้องกันตอน-commit--push)
- [4. เสริม: boot guard (ป้องกันข้อมูลหาย)](#4-เสริม-boot-guard-ป้องกันข้อมูลหาย)
- [ใช้งานประจำวัน](#ใช้งานประจำวัน)
- [Pull ตอนมีไฟล์แก้ค้างอยู่](#pull-ตอนมีไฟล์แก้ค้างอยู่)
- [รายการคำสั่งทั้งหมด](#รายการคำสั่งทั้งหมด)
- [ตั้งค่าใน editor](#ตั้งค่าใน-editor)
- [ถอนการติดตั้ง](#ถอนการติดตั้ง)
- [แก้ปัญหาเบื้องต้น](#แก้ปัญหาเบื้องต้น)
- [หมายเหตุการออกแบบ](#หมายเหตุการออกแบบ)
- [สำหรับนักพัฒนา](#สำหรับนักพัฒนา)

---

## เริ่มต้นแบบเร็ว

สำหรับคนที่อยากเปิดใช้ครบทุกอย่างในทีเดียว ในหนึ่ง workspace:

```bash
git clone https://github.com/chairat25/repo-sentry.git
cd repo-sentry
pnpm install
pnpm -r build
pnpm --filter repo-sentry package        # ได้ไฟล์ packages/vscode-ext/repo-sentry.vsix

# 1. extension สำหรับ editor
code --install-extension packages/vscode-ext/repo-sentry.vsix

# 2. CLI ให้เรียกได้จาก terminal
npm link packages/cli

# 3. ป้องกัน commit/push ใน workspace
repo-sentry install-hooks --path /path/to/your/workspace

# 4. ป้องกันตอน boot service ใน workspace เดียวกัน (แสดงตัวอย่างก่อนเสมอ)
repo-sentry install-guards --path /path/to/your/workspace
repo-sentry install-guards --path /path/to/your/workspace --yes
```

เนื้อหาด้านล่างอธิบายแต่ละขั้นตอนอย่างละเอียด และสิ่งอื่นที่มีให้ใช้เพิ่มเติม

---

## 1. ติดตั้ง extension ใน editor

extension ใช้ไฟล์ `.vsix` เดียวกันทั้ง VS Code และ VS Code fork (สายพันธุ์)
ทุกตัว — Antigravity, Cursor, Windsurf, Trae ให้ status bar (แถบสถานะ)
การ poll และ modal เตือน ใช้ได้เดี่ยวๆ โดยไม่ต้องติดตั้งอย่างอื่นเลย

build ครั้งเดียว:

```bash
pnpm install
pnpm -r build
pnpm --filter repo-sentry package
```

จะได้ไฟล์ `packages/vscode-ext/repo-sentry.vsix` แล้วติดตั้งตาม editor:

```bash
# VS Code
code --install-extension packages/vscode-ext/repo-sentry.vsix

# Cursor
cursor --install-extension packages/vscode-ext/repo-sentry.vsix

# Antigravity IDE
"/Applications/Antigravity IDE.app/Contents/Resources/app/bin/antigravity-ide" \
  --install-extension packages/vscode-ext/repo-sentry.vsix
```

ไม่มี CLI ของ editor? ลากไฟล์ `.vsix` ไปวางที่หน้าต่าง Extensions ใน editor
หรือเปิด Extensions view → เมนู `···` → **Install from VSIX...**

อัปเดตหลัง build ใหม่ ให้ติดตั้งซ้ำด้วย `--force`:

```bash
code --install-extension packages/vscode-ext/repo-sentry.vsix --force
```

แจกให้เพื่อน: ส่งไฟล์ `.vsix` ให้ (ขนาดประมาณ 25KB) — เขาไม่ต้อง clone
repository นี้เลย แค่ไฟล์เดียวก็พอ

---

## 2. ติดตั้ง CLI

CLI จำเป็นสำหรับ git hooks และ boot guard — extension เพียงอย่างเดียวมองไม่เห็น
ตอนที่มีการเรียก `git commit`, `git push`, หรือ `yarn start:dev` ใน terminal

package นี้ยังไม่ได้ publish (เผยแพร่) ขึ้น registry เพราะงั้นต้องติดตั้งจาก repo:

```bash
cd repo-sentry
npm link packages/cli
```

ตรวจว่าเรียกได้จาก PATH แล้ว:

```bash
repo-sentry --help
```

ถ้าไม่อยากใช้ `npm link` ก็เพิ่ม path ของ CLI ที่ build แล้วเข้า PATH ตรงๆ หรือ
ทำ symlink (ลิงก์สัญลักษณ์) เอง:

```bash
ln -s "$(pwd)/packages/cli/dist/index.js" /usr/local/bin/repo-sentry
chmod +x /usr/local/bin/repo-sentry
```

เพื่อนแต่ละคนที่อยากใช้ hooks หรือ boot guard ต้องทำขั้นตอนนี้ในเครื่องตัวเอง
— เป็นการติดตั้งเฉพาะเครื่อง ไม่ได้ติดมาพร้อมกับการ clone `project-genie`

---

## 3. เสริม: git hooks (ป้องกันตอน commit / push)

ติดตั้ง `pre-commit` และ `pre-push` hook ให้ทุก repository ที่เจอใต้ path
ที่ระบุ

```bash
repo-sentry install-hooks --path /path/to/your/workspace
```

- `pre-commit` fetch (ดึงข้อมูล) โดยจำกัดเวลา 3 วินาที แล้วปฏิเสธ commit
  ถ้า branch ตามหลังอยู่
- `pre-push` fetch แบบไม่จำกัดเวลา แล้วปฏิเสธ push — นี่คือตัวที่หยุดปัญหา
  "push โดน reject ต้องมา reset/stash" ตั้งแต่ต้นตอ
- hook ที่ไม่ได้เขียนโดย repo-sentry จะไม่ถูกแตะเลย จะแค่รายงานให้รู้ พร้อม
  บอกบรรทัดที่ต้องเพิ่มเองด้วยมือ
- เพื่อนที่ไม่มี CLI ติดตั้ง จะเจอ hook แล้วพบว่า CLI ไม่มี แล้ว exit 0
  เงียบๆ — ไม่โดน block (กั้น) จาก hook ที่ตัวเองไม่ได้ขอใช้

ทางหนีสำหรับกรณีจำเป็นครั้งเดียว: `git commit --no-verify` /
`git push --no-verify`

ถอนการติดตั้ง:

```bash
repo-sentry uninstall-hooks --path /path/to/your/workspace
```

---

## 4. เสริม: boot guard (ป้องกันข้อมูลหาย)

ตัวนี้คือตัวที่หยุดเหตุการณ์ column หายได้จริง มันจะแก้ script ที่ใช้เริ่มงาน
(`start`, `start:dev`, `dev`, `serve`, `watch` และตัวแปรอื่นๆ — ดูด้านล่าง)
ให้ปฏิเสธการ boot บน checkout ที่เก่าแล้ว

**แสดงตัวอย่างก่อนเสมอ — ค่าเริ่มต้นคือ dry-run (ไม่แก้จริง):**

```bash
repo-sentry install-guards --path /path/to/your/workspace
```

คำสั่งนี้จะพิมพ์ให้เห็นชัดๆ ว่า script ไหนใน `package.json` ไหนจะถูกแก้ และ
เพราะอะไรถ้า script ไหนถูกข้าม จะไม่มีอะไรถูกเขียนจนกว่าจะใส่ `--yes`:

```bash
repo-sentry install-guards --path /path/to/your/workspace --yes
```

สิ่งที่มันเขียนเข้าไปใน script แต่ละตัวที่ถูก guard:

```json
"start:dev": "sh -c 'if command -v repo-sentry >/dev/null 2>&1; then repo-sentry guard; fi' && nest start --watch"
```

ส่วนนำหน้านั้นเป็น POSIX `sh` ล้วนๆ — ทำงานเหมือนกันหมดไม่ว่าจะใช้ npm,
yarn 1, yarn Berry, pnpm, หรือ bun (เคยลองใช้ `pre`/`post` lifecycle script
แล้วตัดทิ้ง เพราะ yarn Berry ไม่รัน script พวกนี้ ทำให้ใช้ได้กับบางคนแต่ใช้ไม่ได้
กับบางคนอย่างเงียบๆ) ส่วน `if command -v` หมายความว่าเพื่อนที่ยังไม่ได้ติดตั้ง
CLI จะ boot ได้ตามปกติแทนที่จะเจอ `command not found`

### Script ไหนบ้างที่จะถูก guard

ใช้ pattern (รูปแบบ) ไม่ใช่รายชื่อตายตัว — ครอบคลุม Nest, Vite, Next,
Angular และอื่นๆ โดยไม่ต้องตั้งค่าเพิ่ม

| | ค่าเริ่มต้น |
|---|---|
| ถูก guard | `start`, `start:*`, `dev`, `dev:*`, `serve`, `serve:*`, `watch`, `watch:*` |
| ไม่ถูก guard เลย | อะไรก็ตามที่ตรงกับ `*prod*`, `*build*`, `*test*`, `*e2e*`, `*lint*`, `*migration*`, `*seed*` |

override (เปลี่ยนค่า) ได้ทุกระดับ:

```bash
# ระบุชื่อ script ตรงๆ ไม่สนใจ pattern เลย
repo-sentry install-guards --path . --scripts "start:dev,worker" --yes

# เพิ่ม pattern ต่อจากค่าเริ่มต้น
repo-sentry install-guards --path . --match "task:*" --exclude "*:ci" --yes
```

หรือกำหนดเฉพาะแต่ละ repository ให้ค่านี้ติดไปกับ repo แทนที่จะอยู่ใน history
คำสั่งของใครคนใดคนหนึ่ง — เพิ่มไฟล์ `.repo-sentry.json` ไว้ข้างๆ `package.json`
ของ repo นั้น:

```json
{ "guardScripts": ["start:dev", "worker:consume"] }
```

**คำสั่งนี้จะแก้และ commit ไฟล์ `package.json` ที่ส่งถึงทั้งทีม** ควรรัน
dry-run ก่อน ตรวจดู diff (ส่วนต่าง) แล้วค่อย commit + push เมื่อพอใจแล้ว
เพื่อนที่ไม่ได้ติดตั้ง CLI จะไม่ได้รับผลกระทบ — boot ได้เหมือนเดิมทุกอย่าง

ข้ามการ guard สำหรับการรันครั้งเดียว:

```bash
REPO_SENTRY_SKIP=1 yarn start:dev
```

ถอนการติดตั้งทั้งหมด:

```bash
repo-sentry uninstall-guards --path /path/to/your/workspace --yes
```

เมื่อ guard บล็อกการ boot มันจะเขียนไฟล์ marker (ตัวจดจำ) ที่ extension ใน
editor เฝ้าดูอยู่ — ถ้าลง extension ไว้ด้วย จะเด้ง modal บอกว่า repo ไหนที่
บล็อกการ boot พร้อมปุ่ม **Pull now** แทนที่จะเห็นแค่ข้อความยาวๆ ใน terminal

---

## ใช้งานประจำวัน

ถ้าลงแค่ extension อย่างเดียว เปิด workspace แล้ว:

- **status bar** (มุมล่างซ้าย) จะขึ้น `✓ repos synced` หรือ
  `⚠ N repos behind` คลิกดูได้ว่า repo ไหนบ้างและสถานะเป็นอย่างไร
- **modal** จะเด้งขึ้นอัตโนมัติทุกครั้งที่มี repository ตามหลังใหม่ — ตอนเปิด
  workspace และตลอดวันที่มีเพื่อน push เข้ามา
- **Pull now** จะ fast-forward (ดึงแบบไม่มี conflict) repo ที่ตามหลังให้เอง
  **Snooze 30m** เลื่อนเตือนชั่วคราว **Details** เปิดดูรายการทั้งหมด
- ถ้ากดปิด modal โดยไม่ pull จะเด้งเตือนซ้ำทุก 15 นาที (ค่าเริ่มต้น จาก
  `repoSentry.remindEveryMinutes`) — เพราะการกดปิดไม่ได้ทำให้ repo หายตามหลัง
- ถ้า repo ที่กำลังจะ pull มีไฟล์แก้ค้างอยู่ (uncommitted) จะมี dialog อีก
  ชั้นถามก่อนเสมอ — ดู [Pull ตอนมีไฟล์แก้ค้างอยู่](#pull-ตอนมีไฟล์แก้ค้างอยู่)
  ด้านล่าง ส่วน repo ที่ไม่มีอะไรเสี่ยงเลยจะ pull ตรงไปเลยไม่มี prompt

ถ้าลง hooks และ boot guard เพิ่มด้วย ความล้าหลังแบบเดียวกันนี้จะหยุด
`git commit`, `git push`, หรือ `yarn start:dev` ก่อนที่จะเกิดความเสียหาย
— ดูหัวข้อ 3 และ 4 ด้านบน

---

## Pull ตอนมีไฟล์แก้ค้างอยู่

`git pull --ff-only` คือคำสั่งที่ปุ่ม "Pull now" ทุกที่รันอยู่แล้ว และมัน
**ปฏิเสธเองอัตโนมัติ ไม่มี force เด็ดขาด** ถ้ามี commit ที่กำลังจะดึงเข้ามา
ไปทับไฟล์ที่คุณแก้ค้างอยู่พอดี — จุดนี้ปลอดภัยอยู่แล้วโดย git เอง ไม่ต้องเตือน
เพิ่ม

ช่องว่างที่เหลือคือกรณีที่ **เงียบกว่านั้น**: ถ้าไฟล์ที่คุณแก้ค้างอยู่ไม่ได้
ชนกับของที่ดึงเข้ามาเลย `--ff-only` จะปล่อยให้ผ่านไปเฉยๆ โดยไม่บอกอะไรคุณ
สักคำ ปลอดภัยจริงแต่ก็ลืมง่าย — เพราะงั้นก่อน pull ทุกครั้ง repo-sentry จะเช็ค
ก่อนว่า repo เป้าหมายมีไฟล์แก้ค้างอยู่มั้ย (`git status --porcelain`) แล้วถ้ามี
จะถามก่อนเสมอ

```
⚠  transaction has uncommitted changes

   Pulling now could carry those changes forward mixed in with new commits.

     Stash & Pull  —  set your changes aside, then pull. Recover them
                       afterward with "git stash pop".
     Pull Anyway   —  pull now. git still refuses if anything actually
                       conflicts — nothing is ever overwritten silently.
```

- **Stash & Pull** — เก็บไฟล์ที่แก้ (ทั้งที่ track อยู่แล้วและไฟล์ใหม่ที่ยัง
  ไม่ track) ไว้ใน stash ก่อน (`git stash push --include-untracked`) แล้วค่อย
  pull **ไม่มีการ pop stash คืนให้อัตโนมัติเด็ดขาด** — ต้องรัน
  `git stash pop` เองใน repo นั้นหลังจากมั่นใจว่า pull สำเร็จแล้ว
- **Pull Anyway** — pull ตรงๆ เลย ถ้ามีอะไรชนกันจริงๆ git จะปฏิเสธเหมือนเดิม
  ปุ่มนี้ไม่ได้ข้ามการตรวจสอบนั้นไป
- **กดปิด (Esc)** — repo นั้นจะไม่ถูกแตะเลย ถ้าสั่ง pull หลาย repo พร้อมกัน
  แล้วมีแค่ตัวเดียวที่ไฟล์ค้างอยู่ ตัวอื่นที่เหลือก็ยัง pull ตามปกติ

repo ที่ไม่มีไฟล์แก้ค้างอยู่เลยจะไม่เห็น dialog นี้เลย — pull ตรงไปเลย ใช้ได้
ทุกที่ที่มีการ pull เกิดขึ้น: modal เตือน repo ตามหลัง, quick-pick สถานะ,
**Pull All**, และปุ่ม **Pull now** ใน modal ของ boot guard

---

## รายการคำสั่งทั้งหมด

```text
repo-sentry status                 ตารางแสดงทุก repository และสถานะ
repo-sentry check                  exit 1 ถ้ามี repository ตามหลังอยู่
repo-sentry check --json           ผลลัพธ์แบบ machine-readable
repo-sentry check --path <dir>     เช็คเฉพาะ workspace/repo ที่ระบุ
repo-sentry check --no-fetch       ใช้ ref ที่ cache ไว้แทนการ fetch
repo-sentry check --stage push     ปรับข้อความให้เหมาะกับ push
repo-sentry check --fetch-timeout <ms>   กำหนดเวลา fetch เอง

repo-sentry guard                  exit 1 ถ้า repo นี้ตามหลัง (boot guard)
repo-sentry guard --path <dir>     guard เฉพาะ repo ที่ระบุ

repo-sentry install-hooks --path <dir>     เขียน pre-commit และ pre-push
repo-sentry uninstall-hooks --path <dir>   ถอนออก

repo-sentry install-guards --path <dir>            แสดงตัวอย่างก่อน
repo-sentry install-guards --path <dir> --yes      แก้จริง
repo-sentry install-guards --path <dir> --scripts "a,b"   ระบุชื่อ script ตรงๆ
repo-sentry install-guards --path <dir> --match "glob" --exclude "glob"
repo-sentry uninstall-guards --path <dir> --yes    เอาส่วนนำหน้า guard ออก
```

exit code ของ `check` และ `guard`: `0` = synced/ahead/unreachable/untracked,
`1` = behind หรือ diverged, `2` = internal error `unreachable` (ออฟไลน์,
credential พัง) จะไม่ block เลยโดยตั้งใจ — เครื่องมือที่หยุดคุณตอนทำงาน
ออฟไลน์ไม่ได้ จะโดนถอนทิ้งในที่สุด

---

## ตั้งค่าใน editor

| Setting | ค่าเริ่มต้น | หน้าที่ |
|---|---|---|
| `repoSentry.alertStyle` | `modal` | `modal` (บังหน้าจอ กลาง) หรือ `notification` (แจ้งเตือนมุมจอ) |
| `repoSentry.remindEveryMinutes` | `15` | เตือนซ้ำระหว่างที่ยังตามหลังอยู่ ใส่ `0` เพื่อปิดการเตือนซ้ำ |
| `repoSentry.pollIntervalSeconds` | `60` | เช็คแต่ละ repository ถี่แค่ไหน |
| `repoSentry.maxDepth` | `2` | ความลึกของโฟลเดอร์ที่จะสแกนหา repository |
| `repoSentry.exclude` | `[]` | glob pattern ของ path repository ที่จะไม่สนใจ |
| `repoSentry.notifyOnOpen` | `true` | เช็คและเตือนทันทีที่เปิด workspace |
| `repoSentry.snoozeMinutes` | `30` | **Snooze** จะเลื่อนเตือนไปนานแค่ไหน |
| `repoSentry.fetchTimeoutMs` | `15000` | เวลาที่ให้ในการ fetch แต่ละครั้ง |

ตั้งค่าได้ที่หน้า Settings ของ editor (ค้นหา "repo-sentry") หรือใน
`.vscode/settings.json`:

```json
{
  "repoSentry.alertStyle": "notification",
  "repoSentry.remindEveryMinutes": 0
}
```

---

## ถอนการติดตั้ง

```bash
# extension
code --uninstall-extension internal.repo-sentry

# hooks และ boot guard ต่อ workspace
repo-sentry uninstall-hooks --path /path/to/your/workspace
repo-sentry uninstall-guards --path /path/to/your/workspace --yes

# CLI
npm unlink @repo-sentry/cli   # หรือลบ symlink ที่สร้างไว้เอง
```

---

## แก้ปัญหาเบื้องต้น

**เปิด workspace แล้วไม่มีอะไรเกิดขึ้นเลย**
เช็ค output channel ชื่อ `repo-sentry` (View → Output → repo-sentry) ถ้าขึ้นว่า
`git binary not found on PATH` ให้ติดตั้ง git แล้ว reload window ใหม่

**`repo-sentry: command not found` ตอนอยู่ใน hook หรือ guard script**
เครื่องนั้นยังไม่ได้ link CLI — ดู [ขั้นตอนที่ 2](#2-ติดตั้ง-cli) เป็นเรื่องปกติ
สำหรับเพื่อนที่ยังไม่ได้ตั้งค่า ไม่มีผลกระทบต่อการ boot หรือ commit ของเขา
แค่เงียบไปเฉยๆ

**เปลี่ยน setting แล้วดูเหมือนไม่มีผล**
ใช้ `Developer: Reload Window` จาก command palette เพื่อรีสตาร์ท extension
เต็มรูปแบบ

**repo ขึ้นสถานะ `unreachable`**
fetch remote ไม่สำเร็จ — อาจเพราะออฟไลน์, VPN ดับ, หรือ credential เสีย สถานะนี้
ถูกออกแบบมาให้ไม่ block อะไรเลย เช็ค error ได้ด้วย `repo-sentry status` หรือ
`repo-sentry check --json`

---

## หมายเหตุการออกแบบ

**hook ทั้งสองตัว fetch จริง** เคยลองอ่านแค่ ref ที่ cache ไว้ตอน commit
แล้วพบว่าใช้ไม่ได้จริง — clone ที่ยังไม่เคย fetch ตั้งแต่เพื่อน push จะอ่านว่า
synced ทั้งที่ตามหลังอยู่ ซึ่งเป็นเคสที่เครื่องมือนี้มีไว้ดักพอดี `pre-commit`
เลยจำกัดเวลา fetch ไว้ 3 วินาที ถ้า timeout จะได้สถานะ `unreachable` ซึ่งไม่
block

**`unreachable` ไม่ block เด็ดขาด** เน็ตหลุด, credential พัง, remote หาย —
ทุกกรณีปล่อยให้ทำงานต่อได้

**Pull แบบ fast-forward เท่านั้น** ถ้า branch แยกทางกันแล้ว repo-sentry
จะรายงานแล้วหยุด ไม่เลือก merge หรือ rebase แทนผู้ใช้ เพราะเป็นต้นเหตุที่
working tree พังบ่อยที่สุด

**ไม่แตะ hook ที่ไม่ได้เขียนเอง** `pre-commit` ที่ repo-sentry ไม่ได้เขียน
จะถูกปล่อยไว้เฉยๆ พร้อมรายงานบรรทัดที่ต้องเพิ่มเอง

**การเตือนเป็น modal โดยค่าเริ่มต้น** เพราะ toast มุมจอมักถูกมองข้าม ซึ่งเป็น
สาเหตุที่ปัญหา checkout เก่ายังเกิดซ้ำอยู่เรื่อยๆ

### สิ่งที่ตั้งใจไม่ทำ

- ไม่แก้ merge conflict ให้
- ไม่แยกแยะว่าไฟล์ไหนถูกแก้ — `behind > 0` คือสัญญาณเดียวที่ใช้ และอันตราย
  ของ boot guard ก็เกิดกับ checkout ที่เก่าแล้วไม่ว่าจะเป็นไฟล์ไหนก็ตาม
- ไม่รัน server ใดๆ — การตรวจจับทั้งหมดทำในเครื่อง ไม่มี webhook ไม่มี
  hosted service
- ไม่อ่านหรือเก็บ credential ใดๆ — ใช้ `git` ที่มีอยู่ในเครื่องอยู่แล้ว
  ผ่าน credential setup ที่มีอยู่เดิม

---

## สำหรับนักพัฒนา

```bash
pnpm install
pnpm test
pnpm -r typecheck
pnpm -r build
pnpm --filter repo-sentry package   # ได้ไฟล์ repo-sentry.vsix
```

test สร้าง git repository จริงชั่วคราวแทนการ mock (จำลอง) ตัว binary `git`
เพื่อให้ทดสอบ plumbing (กลไกภายใน) จริงๆ เกณฑ์ coverage (การครอบคลุมโค้ด)
คือ 80% lines บน `packages/core`
