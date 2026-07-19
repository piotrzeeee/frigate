"""Peewee migrations -- 036_create_known_plate_table.py.

This migration creates the known_plate table for managing recognized license
plates with labels and optional expiration (temporary access).
"""

import peewee as pw

SQL = pw.SQL


def migrate(migrator, database, fake=False, **kwargs):
    migrator.sql(
        """
        CREATE TABLE IF NOT EXISTS knownplate (
            plate VARCHAR(20) NOT NULL,
            label VARCHAR,
            expires_at DATETIME,
            created_at DATETIME,
            PRIMARY KEY (plate)
        )
        """
    )


def rollback(migrator, database, fake=False, **kwargs):
    migrator.sql("DROP TABLE IF EXISTS knownplate")
