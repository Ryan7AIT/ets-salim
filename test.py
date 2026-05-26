import argparse

from api.notification_service import send_telegram_message


def main() -> int:
    parser = argparse.ArgumentParser(description="Send a manual Telegram test notification.")
    parser.add_argument(
        "message",
        nargs="?",
        default="Hi there!",
        help="Message text to send.",
    )
    args = parser.parse_args()

    if not send_telegram_message(args.message):
        print("Telegram message was not sent. Configure TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID first.")
        return 1

    print("Telegram message sent.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())