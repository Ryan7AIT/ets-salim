import argparse
from pathlib import Path

try:
    from .notification_service import sync_telegram_notifications_for_db
except ImportError:
    from notification_service import sync_telegram_notifications_for_db


DEFAULT_DB_PATH = Path(__file__).with_name("plombtrack.sqlite3")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Check for unsent intervention notifications and send them to Telegram."
    )
    parser.add_argument(
        "--db-path",
        default=str(DEFAULT_DB_PATH),
        help="Path to the SQLite database file.",
    )
    args = parser.parse_args()

    result = sync_telegram_notifications_for_db(args.db_path)
    if result["status"] != "ok":
        if result["status"] == "telegram_not_configured":
            print(
                "Telegram is not configured yet. Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID "
                "in the environment or the project .env file."
            )
            return 0
        print(f"Database is not initialized yet: {args.db_path}")
        return 0

    print(
        "Checked "
        f"{result['checked_notifications']} notification(s), "
        f"sent {result['sent_notifications']} new Telegram message(s)."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
