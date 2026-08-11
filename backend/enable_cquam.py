#!/usr/bin/env python3
import argparse
from pathlib import Path


def insert_after(path: Path, anchor: str, addition: str, marker: str) -> None:
    text = path.read_text(encoding="utf-8")
    if marker in text:
        return
    if anchor not in text:
        raise RuntimeError(f"C-QUAM compatibility anchor missing in {path}: {anchor!r}")
    path.write_text(text.replace(anchor, anchor + addition, 1), encoding="utf-8")


def check(path: Path, marker: str) -> None:
    if marker not in path.read_text(encoding="utf-8"):
        raise RuntimeError(f"C-QUAM marker missing in {path}: {marker!r}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dsp", required=True, type=Path)
    parser.add_argument("--modes", required=True, type=Path)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()

    if not args.check:
        insert_after(
            args.dsp,
            '        elif demod == "sam":\n            from csdr.chain.analog import SAm\n            return SAm(AgcProfile(self.props["am_agc_profile"]))\n',
            '        elif demod == "cquam":\n            from csdr.chain.analog import Cquam\n            return Cquam(self.props["hd_output_rate"])\n',
            'elif demod == "cquam"',
        )
        insert_after(
            args.modes,
            '        AnalogMode("sam", "SAM", bandpass=Bandpass(-4000, 4000)),\n',
            '        AnalogMode("cquam", "C-QUAM", bandpass=Bandpass(-15000, 15000)),\n',
            'AnalogMode("cquam", "C-QUAM"',
        )

    check(args.dsp, 'elif demod == "cquam"')
    check(args.modes, 'AnalogMode("cquam", "C-QUAM"')


if __name__ == "__main__":
    main()
