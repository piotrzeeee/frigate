"""Peewee migrations -- 038_create_line_crossing_table.py.

This migration creates the linecrossing table, which stores one row per
tracked object crossing of a configured counting line.
"""

import peewee as pw

SQL = pw.SQL


def migrate(migrator, database, fake=False, **kwargs):
    migrator.sql(
        """
        CREATE TABLE IF NOT EXISTS linecrossing (
            id INTEGER NOT NULL PRIMARY KEY,
            camera VARCHAR(20) NOT NULL,
            line VARCHAR(50) NOT NULL,
            label VARCHAR(20) NOT NULL,
            direction VARCHAR(3) NOT NULL,
            timestamp DATETIME NOT NULL,
            event_id VARCHAR(30)
        )
        """
    )
    migrator.sql(
        "CREATE INDEX IF NOT EXISTS linecrossing_camera_timestamp"
        " ON linecrossing (camera, timestamp)"
    )
    migrator.sql(
        "CREATE INDEX IF NOT EXISTS linecrossing_timestamp"
        " ON linecrossing (timestamp)"
    )


def rollback(migrator, database, fake=False, **kwargs):
    migrator.sql("DROP TABLE IF EXISTS linecrossing")
