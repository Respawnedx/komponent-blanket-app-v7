# Import and Backup Formats

This document describes the import formats currently supported by the Komponentdatabase prototype. It is intentionally strict about what works today, so a future migration from Microsoft Access can be planned without guessing.

## Supported Import Paths

The app has two admin-only import paths:

1. **Access / Excel / CSV tag list**
   Imports existing tag numbers into records. This is meant for migration from the old Microsoft Access database, Excel exports, CSV files, or simple manually prepared tag lists.

2. **JSON backup**
   Restores or transfers full records exported with the app's **Backup JSON** button.

These formats are not the same. Use the tag-list import for old source systems and use JSON backup for full prototype backups.

## Access / Excel / CSV Tag List

### Accepted Files

The file picker accepts:

- `.xlsx`
- `.xls`
- `.csv`

The browser parses these files with SheetJS, loaded from the CDN in `index.html`.

### Sheet and Column Rules

The import currently reads:

- The first worksheet only.
- The first row as the header row.
- A column named `NR`, case-insensitive.
- If no `NR` column is found, the first column is used as a fallback.

Recommended layout:

```csv
NR
1400.34
1400.210
5222.901
5222.902
```

Only the `NR` column is used today. Other columns such as description, plant, PID, comments, or status are ignored by the current import.

### Tag Syntax

Each imported tag must look like this:

```text
<main component number>.<setup number>
```

Examples that work:

```text
1400.34
1400.034
1400.210
5222.901
001202.110
```

The main component number must be numeric and can be 1-10 digits.

The setup number is interpreted like this:

- `1` through `99`, including values written as `001`, `01`, or `34`, are imported into the `0xx` series.
- `101` through `999` are imported into the matching `1xx` through `9xx` series.
- Series numbers ending in `00`, such as `100`, `200`, or `900`, are rejected because suffix `00` is not valid in the component form.

Invalid examples:

```text
1400
1400.
1400.000
1400.100
ABC.210
1400.A34
```

### Multiple Tags in One Cell

One tag per row is recommended, but the current parser also accepts multiple tags in one cell separated by:

- New lines
- Commas
- Semicolons
- Tabs
- Spaces

Example:

```text
1400.34; 1400.210; 1400.211
```

For migration work, prefer one tag per row because it is easier to validate before import.

### What the Import Does

For each valid tag, the app:

1. Extracts the main component number and setup number.
2. Groups tags by main component number.
3. Finds an existing record with the same normalized main component number, if one exists.
4. Creates a new record if no matching record exists.
5. Adds missing setup numbers to the record.
6. Marks imported setup numbers as `I brug`.
7. Marks the source as `Scan/import`.
8. Writes audit and revision entries.

The import does not remove existing numbers. It only adds missing imported numbers.

If a setup number already exists on the record, the import keeps the existing status and does not overwrite it.

### Current Limitations

The Access / Excel / CSV import is a tag-list import, not a full record migration format. Today it does not import:

- `Beskrivelse`
- `Anlæg`
- `PID Tegningsnr.`
- `Signatur`
- Per-tag status from the old database
- Old revision history

For a future full migration, add an extended importer with explicit columns such as:

```csv
Hovedkomponentnr,Beskrivelse,Anlæg,PID Tegningsnr,Opsætning,Status,Kilde,Kommentar
1400,Luftudskiller,Isvand 3,1756;1785,034,I brug,Access,Existing number
1400,Luftudskiller,Isvand 3,1756;1785,210,Projekt,Access,Reserved for project
```

That extended format is not implemented yet.

## Exporting From Microsoft Access

For a reliable prototype migration, create an Access query that returns one column named `NR`, with one full tag per row.

Example Access query pattern:

```sql
SELECT CStr([Hovedkomponentnr]) & "." & Format([Opsaetning], "000") AS NR
FROM [YourAccessTableOrQuery]
WHERE [Hovedkomponentnr] Is Not Null
  AND [Opsaetning] Is Not Null;
```

Adjust the table and field names to match the old Access database.

Recommended export options:

- Export the query to `.xlsx` when possible.
- Use text formatting for the `NR` column so values such as `1400.034` are not converted by Excel.
- For CSV, keep a simple one-column file with the header `NR`.
- Save CSV as UTF-8 when possible.

Microsoft documents `DoCmd.TransferText` for importing/exporting text files such as CSV and `DoCmd.TransferSpreadsheet` for importing/exporting spreadsheet files such as Excel. The Access Export Wizard can also export query results to Excel.

## Excel and CSV Notes

When preparing a manual Excel file:

1. Put `NR` in cell `A1`.
2. Put one full tag per row below it.
3. Format the `NR` column as Text before entering tags.
4. Keep the tag separator as a period, for example `1400.034`.

When preparing CSV:

```csv
NR
1400.034
1400.210
5222.901
```

Do not use the app's normal Excel export as a JSON-backup replacement. The Excel export is for reporting and print support. JSON backup is the round-trip format for full records.

## JSON Backup

The **Backup JSON** button creates a local `.json` download with this filename pattern:

```text
komponentdatabase-backup-YYYY-MM-DD_HHMM.json
```

Current backup schema:

```json
{
  "schema": "komponentdatabase.backup.v2",
  "exportedAt": "2026-08-25T10:15:30.000Z",
  "source": "cloud",
  "exportedBy": "NJ",
  "count": 2,
  "records": [
    {
      "id": "record-id",
      "hovedkomponentnr": "1400",
      "beskrivelse": "Luftudskiller",
      "anlaeg": "Isvand 3",
      "pid": "1756;1785",
      "signatur1": "NJ",
      "signatur2": "2026-08-25",
      "selectedCodes": ["34", "210"],
      "codeSources": {
        "34": "manual",
        "210": "manual"
      },
      "codeMeta": {
        "34": {
          "by": "NJ",
          "at": "2026-08-25T10:15:30.000Z",
          "source": "manual",
          "mark": "blue",
          "pid": "1756",
          "pidIdx": 0,
          "pidColor": 0
        },
        "210": {
          "by": "PLAN",
          "at": "2026-08-25T10:16:00.000Z",
          "source": "manual",
          "mark": "reserved",
          "pid": "1785",
          "pidIdx": 1,
          "pidColor": 1
        }
      },
      "editedBy": "NJ",
      "updatedAt": "2026-08-25T10:16:00.000Z",
      "audit": [],
      "revisions": []
    }
  ]
}
```

The JSON import accepts:

- The current backup object with `records`.
- Older backups that are just a raw array of records.
- Objects with `database.records`, for compatibility with possible wrapped backup files.

### JSON Import Behavior

In cloud mode, JSON import upserts the records in the file one by one. It does not delete cloud records that are missing from the backup file.

In local mode, JSON import replaces the local browser record list with the imported record list.

JSON backup is intended for prototype backup, transfer, troubleshooting, and rollback before large imports. It is not a long-term production database backup strategy.

## Recommended Migration Workflow

1. Click **Backup JSON** before any import.
2. Export a clean `NR` tag list from Access or Excel.
3. Validate a small sample manually.
4. Import the sample into the app.
5. Check search, availability, selected numbers, and revision log.
6. Repeat with the full export.
7. Download a new **Backup JSON** after the successful import.

## External References

- Microsoft Learn: `DoCmd.TransferText` for Access text/CSV import and export.
- Microsoft Learn: `DoCmd.TransferSpreadsheet` for Access spreadsheet import and export.
- Microsoft Support: Access Export Wizard for exporting Access data to Excel.
- Microsoft Support: Excel CSV/text import and export.
