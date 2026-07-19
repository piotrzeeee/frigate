"""Peewee migrations -- 037_create_alarm_tables.py.

This migration creates the alarm tables: a single-row armed state and a log of
alarm triggers (review alerts that occurred while the alarm was armed).
"""

import peewee as pw

SQL = pw.SQL


def migrate(migrator, database, fake=False, **kwargs):
    migrator.sql(
        """
        CREATE TABLE IF NOT EXISTS alarmstate (
            id INTEGER NOT NULL PRIMARY KEY CHECK (id = 0),
            armed INTEGER NOT NULL DEFAULT 0,
            updated_at DATETIME
        )
        """
    )
    migrator.sql("INSERT OR IGNORE INTO alarmstate (id, armed) VALUES (0, 0)")
    migrator.sql(
        """
        CREATE TABLE IF NOT EXISTS alarmtrigger (
            review_id VARCHAR(30) NOT NULL,
            camera VARCHAR(20) NOT NULL,
            ts DATETIME,
            data TEXT,
            PRIMARY KEY (review_id)
        )
        """
    )


def rollback(migrator, database, fake=False, **kwargs):
    migrator.sql("DROP TABLE IF EXISTS alarmstate")
    migrator.sql("DROP TABLE IF EXISTS alarmtrigger")
