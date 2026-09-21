# @project/android — owned by Agent 4

Native Android prong (Path B). Pure Node modules (no SDK needed to author; verified live
on the demo laptop which has Android Studio/SDK):

- `src/scanner.ts` — detect android project (settings.gradle(.kts), manifest, srcDirs)
- `src/gradle.ts` — spawn `gradlew` tasks, stream lines
- `src/errors.ts` — parse build output → `file:line:col` → Problems panel
- `src/adb.ts` — devices + AVD list, emulator launch, install/run

Fixtures in `test/` (sample gradle output, fake project trees). Live SDK sessions happen
on the demo laptop at merge windows only. Gradle daemon capped `-Xmx2g`.