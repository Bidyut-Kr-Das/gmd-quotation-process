from pathlib import Path
import re
import sys


def convert_to_insert_many(input_file, output_file):
    text = Path(input_file).read_text(encoding="utf-8")

    # Find every INSERT statement and its common column list
    pattern = re.compile(
        r'INSERT\s+INTO\s+"ContractReview"\s*\((.*?)\)\s*VALUES\s*',
        re.IGNORECASE | re.DOTALL
    )

    matches = list(pattern.finditer(text))

    if not matches:
        raise ValueError("No INSERT statements found.")

    # Column list from the first INSERT
    columns = matches[0].group(1).strip()

    rows = []

    for i, match in enumerate(matches):
        start = match.end()

        # End of this INSERT = beginning of next INSERT
        if i + 1 < len(matches):
            end = matches[i + 1].start()
        else:
            end = len(text)

        values = text[start:end].strip()

        # Remove trailing semicolon
        values = values.rstrip(";").strip()

        if values:
            rows.append(values)

    # Build multi-row INSERT
    result = (
        f'INSERT INTO "ContractReview" ({columns}) VALUES\n'
        + ",\n".join(rows)
        + ";\n"
    )

    Path(output_file).write_text(result, encoding="utf-8")

    print(f"Found {len(rows)} INSERT statements")
    print(f"Created: {output_file}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage:")
        print("python convert.py input.sql output.sql")
        sys.exit(1)

    convert_to_insert_many(sys.argv[1], sys.argv[2])