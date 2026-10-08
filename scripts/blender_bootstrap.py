# Runs a target script inside headless Blender with stdout/stderr captured to a log file,
# because the Store build of Blender detaches its console. Invoked by scripts/blender-run.sh.
import runpy
import sys
import traceback

argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
log_path, target, *rest = argv
log = open(log_path, "w", buffering=1, encoding="utf-8")
sys.stdout = sys.stderr = log
sys.argv = [target, *rest]
try:
    runpy.run_path(target, run_name="__main__")
except SystemExit as e:
    if e.code not in (None, 0):
        print(f"[blender-run] exit code {e.code}")
        log.close()
        raise
except BaseException:
    traceback.print_exc()
    log.close()
    sys.exit(1)
log.close()
