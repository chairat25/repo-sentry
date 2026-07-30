# repo-sentry

[English](README.md) | **[ภาษาไทย](README.th.md)**

แจ้งเตือนเมื่อ git repository ตามหลัง remote (ต้นทางไกล) — ก่อน commit
ก่อน push ก่อน boot service และระหว่างที่กำลังทำงานอยู่

ออกแบบมาสำหรับทีมที่นักพัฒนาหลายคนใช้ branch เดียวกันข้าม repository หลายตัว
มีไว้กัน 2 เหตุการณ์นี้โดยเฉพาะ

- **Push ชนกัน** — คนหนึ่ง push แล้ว อีกคนที่ยังไม่ pull มา commit บนฐานเก่า
  พอ push ก็โดน reject ต้องมาแก้ด้วย `git reset`/`stash` ที่มักทำให้
  working tree รกและสับสน
- **ข้อมูลหายเงียบ** — มีคนเพิ่ม column ใหม่ในฐานข้อมูล แล้วเพื่อนที่ยังไม่
  pull ไป boot service ที่ใช้ ORM แบบ sync schema (TypeORM
  `synchronize: true`, Sequelize `sync({ alter: true })` ฯลฯ) — ORM จะลบ
  column ทิ้งให้ตรงกับ entity เก่าในเครื่องตัวเอง ข้อมูลในนั้นหายกู้คืนไม่ได้

---

## เริ่มใช้

**อยากได้แค่ตัวเตือน?** ทำแค่นี้พอ:

1. โหลด `repo-sentry.vsix` จาก [หน้า Releases](https://github.com/chairat25/repo-sentry/releases)
2. ติดตั้งใน editor (VS Code, Antigravity, Cursor, Windsurf ใช้ได้หมด):
   ```bash
   code --install-extension repo-sentry.vsix
   ```
   ไม่มี terminal? ลากไฟล์ไปวางที่หน้าต่าง Extensions ได้เลย
3. เปิด workspace — จบ ไม่ต้องตั้งค่าอะไรเพิ่ม

**อยากให้มันหยุด commit/push/boot ที่อาจเกิดปัญหาด้วย?** โหลดไฟล์
`repo-sentry.cjs` จากหน้า Releases เดียวกัน แล้ว:

```bash
chmod +x repo-sentry.cjs
sudo mv repo-sentry.cjs /usr/local/bin/repo-sentry

repo-sentry install-hooks --path /path/to/your/workspace     # กัน commit/push
repo-sentry install-guards --path /path/to/your/workspace    # กัน boot service (แค่แสดงตัวอย่างก่อน)
repo-sentry install-guards --path /path/to/your/workspace --yes   # แก้จริง
```

เท่านี้พอสำหรับคนส่วนใหญ่แล้ว ที่เหลือด้านล่างเป็นรายละเอียดเสริม — flag,
การตั้งค่า, วิธีถอน, และวิธี build เอง

---

## ติดตั้งไปแล้ว? เช็คว่าครอบคลุมแค่ไหนแล้ว

มี 3 ชั้นที่แยกกันเป็นอิสระ และเป็นเรื่องปกติที่จะมีแค่บางชั้น รันคำสั่งพวกนี้
กับ **โฟลเดอร์ workspace ของคุณเอง** — โฟลเดอร์ที่รวม service repository
ทุกตัวไว้ข้างๆ กัน (เช่น `~/projects/my-workspace` หรือชื่อที่คุณตั้งไว้):

```bash
# มี CLI ใช้ได้แล้วหรือยัง?
repo-sentry --help

# ตอนนี้แต่ละ repo ใน workspace เป็นยังไงบ้าง?
repo-sentry status --path ~/projects/my-workspace
```

`status` จะเดินหา git repository ทุกตัวใต้ path นั้น แล้วพิมพ์ทีละบรรทัด —
เป็นตารางเดียวกับที่ status bar ของ extension สรุปให้เห็น:

```text
✓  auth-service      dev                         
⚠  billing-service   dev                         ↓3
✓  web-frontend      dev                         
⚠  data-pipeline     feature/some-branch         ↓4 ↑5  (diverged)
```

`✓` คือ synced แล้ว `⚠` คือตามหลังอยู่ (หรือ diverged ซึ่งต้อง
`rebase`/`merge` เองก่อนถึงจะ push ได้ — repo-sentry จะไม่เลือกวิธีนั้นแทนคุณ)

**hooks กับ boot guard ต่อสายจริงแล้วหรือยัง หรือมีแค่ extension?**
ทั้ง `install-hooks` และ `install-guards` รันซ้ำได้ปลอดภัยเสมอ — ถ้าไม่ใส่
`--yes` มันแค่รายงานให้ดู ไม่เขียนอะไรทั้งนั้น:

```bash
repo-sentry install-guards --path ~/projects/my-workspace
```

```text
auth-service/package.json
  ok     start:dev           (already guarded)
  skip   start:prod          (excluded by *prod*)

billing-service/package.json
  guard  start:dev           node server.js
  skip   build               (excluded by *build*)

Would change 1 script. Nothing was written.
Re-run with --yes to apply:  repo-sentry install-guards --yes
```

`ok (already guarded)` แปลว่า script นั้นครอบคลุมแล้ว `guard` แปลว่ายังไม่ได้
ทำ — รันซ้ำพร้อม `--yes` เพื่อปิดช่องว่างนั้น ถ้าไม่มีอันไหนขึ้น `guard` เลย
และ `repo-sentry status` บอกว่าทุก repo เป็น `✓` แปลว่าครอบคลุมเต็มแล้ว

---

## หน้าตาตอนใช้งานจริง

- **status bar** (มุมล่างซ้าย) ขึ้น `✓ repos synced` หรือ `⚠ N repos behind`
  คลิกดูได้ว่า repo ไหนบ้างและสถานะเป็นอย่างไร
- **modal** เด้งขึ้นอัตโนมัติทุกครั้งที่มี repository ตามหลังใหม่ — ตอนเปิด
  workspace และตลอดวันที่มีเพื่อน push เข้ามา **Pull now** แก้ให้เลย
  **Snooze 30m** เลื่อนเตือน **Details** เปิดดูรายการทั้งหมด
- กดปิดโดยไม่ pull จะเด้งเตือนซ้ำทุก 15 นาที — เพราะการกดปิดไม่ได้ทำให้ repo
  หายตามหลัง
- ถ้าลง hooks และ boot guard เพิ่มด้วย ความล้าหลังแบบเดียวกันนี้จะหยุด
  `git commit`, `git push`, หรือ `yarn start:dev` ก่อนที่จะเกิดความเสียหาย

### มีไฟล์แก้ค้างอยู่? มันจะถามก่อน

`git pull --ff-only` (คำสั่งที่ปุ่ม "Pull now" ทุกที่รันอยู่) ปฏิเสธเอง
อัตโนมัติอยู่แล้ว ไม่มี force เด็ดขาด ถ้ามีอะไรจะมาทับไฟล์ที่คุณแก้ค้างอยู่
สิ่งเดียวที่มันไม่เตือนคือไฟล์แก้ค้างที่ไม่ได้ชนกับอะไรเลย ซึ่งมันจะ pull
ผ่านไปเงียบๆ — ก่อน pull ทุกครั้ง repo-sentry จะเช็คจุดนี้แล้วถามก่อน:

```
⚠  billing-service has uncommitted changes

     Stash & Pull  —  เก็บงานไว้ก่อน แล้วค่อย pull กู้คืนด้วย
                       "git stash pop"
     Pull Anyway   —  pull ตรงๆ เลย git ยังเช็คชนให้เหมือนเดิม
```

repo ที่สะอาดจะไม่เห็น dialog นี้เลย — pull ตรงไปเลย

---

## รายละเอียดเพิ่มเติม (ถ้าต้องการ)

<details>
<summary><strong>รายการคำสั่งทั้งหมด</strong></summary>

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
credential พัง) จะไม่ block เลยโดยตั้งใจ

ทางหนีสำหรับกรณีจำเป็นครั้งเดียว: `git commit --no-verify`,
`git push --no-verify`, `REPO_SENTRY_SKIP=1 yarn start:dev`

</details>

<details>
<summary><strong>git hooks ทำงานยังไง</strong></summary>

`repo-sentry install-hooks` เขียน `pre-commit` และ `pre-push` hook ให้ทุก
repository ที่เจอใต้ path ที่ระบุ

- `pre-commit` fetch โดยจำกัดเวลา 3 วินาที แล้วปฏิเสธ commit ถ้า branch
  ตามหลังอยู่
- `pre-push` fetch แบบไม่จำกัดเวลา แล้วปฏิเสธ push — นี่คือตัวที่หยุดปัญหา
  "push โดน reject ต้องมา reset/stash" ตั้งแต่ต้นตอ
- hook ที่ไม่ได้เขียนโดย repo-sentry จะไม่ถูกแตะเลย จะแค่รายงานให้รู้ พร้อม
  บอกบรรทัดที่ต้องเพิ่มเองด้วยมือ
- เพื่อนที่ไม่มี CLI ติดตั้ง จะเจอ hook แล้วพบว่า CLI ไม่มี แล้ว exit 0
  เงียบๆ — ไม่โดน block จาก hook ที่ตัวเองไม่ได้ขอใช้

</details>

<details>
<summary><strong>boot guard ทำงานยังไง และครอบ script ไหนบ้าง</strong></summary>

ตัวนี้คือตัวที่หยุดเหตุการณ์ column หายได้จริง มันจะแก้ script ที่ใช้เริ่มงาน
ให้ปฏิเสธการ boot บน checkout ที่เก่าแล้ว:

```json
"start:dev": "sh -c 'if command -v repo-sentry >/dev/null 2>&1; then repo-sentry guard; fi' && nest start --watch"
```

ส่วนนำหน้าเป็น POSIX `sh` ล้วนๆ — ทำงานเหมือนกันหมดไม่ว่าจะใช้ npm, yarn 1,
yarn Berry, pnpm, หรือ bun (เคยลองใช้ `pre`/`post` lifecycle script แล้ว
ตัดทิ้ง เพราะ yarn Berry ไม่รัน script พวกนี้ ทำให้ใช้ได้กับบางคนแต่ใช้ไม่ได้
กับบางคนอย่างเงียบๆ)

**Script ไหนบ้างที่จะถูก guard** — ใช้ pattern ไม่ใช่รายชื่อตายตัว ครอบคลุม
Nest, Vite, Next, Angular และอื่นๆ โดยไม่ต้องตั้งค่าเพิ่ม:

| | ค่าเริ่มต้น |
|---|---|
| ถูก guard | `start`, `start:*`, `dev`, `dev:*`, `serve`, `serve:*`, `watch`, `watch:*` |
| ไม่ถูก guard เลย | อะไรก็ตามที่ตรงกับ `*prod*`, `*build*`, `*test*`, `*e2e*`, `*lint*`, `*migration*`, `*seed*` |

override ได้ทุกระดับ:

```bash
repo-sentry install-guards --path . --scripts "start:dev,worker" --yes
repo-sentry install-guards --path . --match "task:*" --exclude "*:ci" --yes
```

หรือกำหนดเฉพาะแต่ละ repository ด้วย `.repo-sentry.json` ข้างๆ `package.json`:

```json
{ "guardScripts": ["start:dev", "worker:consume"] }
```

**คำสั่งนี้จะแก้ไฟล์ `package.json` ที่ส่งถึงทั้งทีม** ควรรัน dry-run
(ไม่ใส่ `--yes`) ก่อนเสมอ ตรวจดูก่อน แล้วค่อย commit + push เพื่อนที่ไม่ได้
ติดตั้ง CLI จะไม่ได้รับผลกระทบ — boot ได้เหมือนเดิมทุกอย่าง

เมื่อ guard บล็อกการ boot มันจะเขียนไฟล์ marker ที่ extension เฝ้าดูอยู่ —
ถ้าลง extension ไว้ด้วย จะเด้ง modal พร้อมปุ่ม **Pull now** แทนที่จะเห็นแค่
ข้อความใน terminal

</details>

<details>
<summary><strong>ตั้งค่าใน editor</strong></summary>

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

</details>

<details>
<summary><strong>ถอนการติดตั้ง</strong></summary>

```bash
# extension
code --uninstall-extension internal.repo-sentry

# hooks และ boot guard ต่อ workspace
repo-sentry uninstall-hooks --path /path/to/your/workspace
repo-sentry uninstall-guards --path /path/to/your/workspace --yes

# CLI
sudo rm /usr/local/bin/repo-sentry
```

</details>

<details>
<summary><strong>แก้ปัญหาเบื้องต้น</strong></summary>

**เปิด workspace แล้วไม่มีอะไรเกิดขึ้นเลย**
เช็ค output channel ชื่อ `repo-sentry` (View → Output → repo-sentry) ถ้าขึ้นว่า
`git binary not found on PATH` ให้ติดตั้ง git แล้ว reload window ใหม่

**`repo-sentry: command not found` ตอนอยู่ใน hook หรือ guard script**
เครื่องนั้นยังไม่ได้ติดตั้ง CLI เป็นเรื่องปกติสำหรับเพื่อนที่ยังไม่ได้ตั้งค่า
ไม่มีผลกระทบต่อการ boot หรือ commit ของเขา แค่เงียบไปเฉยๆ

**เปลี่ยน setting แล้วดูเหมือนไม่มีผล**
ใช้ `Developer: Reload Window` จาก command palette เพื่อรีสตาร์ท extension
เต็มรูปแบบ

**repo ขึ้นสถานะ `unreachable`**
fetch remote ไม่สำเร็จ — อาจเพราะออฟไลน์, VPN ดับ, หรือ credential เสีย
สถานะนี้ถูกออกแบบมาให้ไม่ block อะไรเลย

</details>

<details>
<summary><strong>หมายเหตุการออกแบบ</strong></summary>

**hook ทั้งสองตัว fetch จริง** เคยลองอ่านแค่ ref ที่ cache ไว้ตอน commit
แล้วพบว่าใช้ไม่ได้จริง — clone ที่ยังไม่เคย fetch ตั้งแต่เพื่อน push จะอ่านว่า
synced ทั้งที่ตามหลังอยู่ ซึ่งเป็นเคสที่เครื่องมือนี้มีไว้ดักพอดี

**`unreachable` ไม่ block เด็ดขาด** เน็ตหลุด, credential พัง, remote หาย —
ทุกกรณีปล่อยให้ทำงานต่อได้

**Pull แบบ fast-forward เท่านั้น** ถ้า branch แยกทางกันแล้ว repo-sentry
จะรายงานแล้วหยุด ไม่เลือก merge หรือ rebase แทนผู้ใช้

**ไม่แตะ hook ที่ไม่ได้เขียนเอง** `pre-commit` ที่ repo-sentry ไม่ได้เขียน
จะถูกปล่อยไว้เฉยๆ พร้อมรายงานบรรทัดที่ต้องเพิ่มเอง

**การเตือนเป็น modal โดยค่าเริ่มต้น** เพราะ toast มุมจอมักถูกมองข้าม ซึ่งเป็น
สาเหตุที่ปัญหา checkout เก่ายังเกิดซ้ำอยู่เรื่อยๆ

**สิ่งที่ตั้งใจไม่ทำ:** ไม่แก้ merge conflict ให้, ไม่แยกแยะว่าไฟล์ไหนถูกแก้
(`behind > 0` คือสัญญาณเดียว), ไม่รัน server ใดๆ (ตรวจจับในเครื่องล้วนๆ
ไม่มี webhook ไม่มี hosted service), ไม่อ่านหรือเก็บ credential (ใช้ `git`
ที่มีอยู่แล้วในเครื่อง)

</details>

<details>
<summary><strong>สำหรับนักพัฒนา / build เอง</strong></summary>

```bash
git clone https://github.com/chairat25/repo-sentry.git
cd repo-sentry
pnpm install
pnpm test
pnpm -r typecheck
pnpm -r build
pnpm --filter @repo-sentry/cli bundle    # CLI ไฟล์เดียว packages/cli/dist-standalone/repo-sentry.cjs
pnpm --filter repo-sentry package        # extension packages/vscode-ext/repo-sentry.vsix
```

test สร้าง git repository จริงชั่วคราวแทนการ mock ตัว binary `git` เพื่อให้
ทดสอบ plumbing จริงๆ เกณฑ์ coverage คือ 80% lines บน `packages/core`

</details>
