"""Email and ntfy notification utilities for DiskWatch."""

import json
import smtplib
import urllib.request
import urllib.error
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart


def send_ntfy(config: dict, title: str, message: str) -> tuple[bool, str]:
    """Send a notification via ntfy. Returns (success, error_message)."""
    ntfy = config.get("ntfy", {})
    if not ntfy.get("enabled"):
        return False, "ntfy notifications are disabled"

    server_url = ntfy.get("server_url", "https://ntfy.sh").rstrip("/")
    topic = ntfy.get("topic", "")
    priority = ntfy.get("priority", "default")
    auth_token = ntfy.get("auth_token", "")

    if not topic:
        return False, "ntfy topic is not configured"

    url = f"{server_url}/{topic}"
    payload = json.dumps({
        "topic": topic,
        "message": message,
        "title": title,
        "priority": priority,
    }).encode("utf-8")

    req = urllib.request.Request(
        url,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    if auth_token:
        req.add_header("Authorization", f"Bearer {auth_token}")

    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            if resp.status < 300:
                return True, ""
            return False, f"ntfy returned HTTP {resp.status}"
    except urllib.error.HTTPError as e:
        return False, f"ntfy HTTP error: {e.code} {e.reason}"
    except Exception as e:
        return False, f"ntfy error: {e}"


def send_email(config: dict, subject: str, body: str) -> tuple[bool, str]:
    """Send an email notification. Returns (success, error_message)."""
    email_cfg = config.get("email", {})
    if not email_cfg.get("enabled"):
        return False, "email notifications are disabled"

    smtp_host = email_cfg.get("smtp_host", "")
    smtp_port = int(email_cfg.get("smtp_port", 587))
    smtp_tls = email_cfg.get("smtp_tls", True)
    smtp_user = email_cfg.get("smtp_user", "")
    smtp_password = email_cfg.get("smtp_password", "")
    from_address = email_cfg.get("from_address", "")
    to_addresses = email_cfg.get("to_addresses", [])

    if not smtp_host:
        return False, "SMTP host is not configured"
    if not from_address:
        return False, "From address is not configured"
    if not to_addresses:
        return False, "No recipient addresses configured"

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = from_address
    msg["To"] = ", ".join(to_addresses)
    msg.attach(MIMEText(body, "plain"))

    try:
        if smtp_tls:
            server = smtplib.SMTP(smtp_host, smtp_port, timeout=15)
            server.starttls()
        else:
            server = smtplib.SMTP_SSL(smtp_host, smtp_port, timeout=15)

        if smtp_user and smtp_password:
            server.login(smtp_user, smtp_password)

        server.sendmail(from_address, to_addresses, msg.as_string())
        server.quit()
        return True, ""
    except smtplib.SMTPAuthenticationError:
        return False, "SMTP authentication failed"
    except smtplib.SMTPException as e:
        return False, f"SMTP error: {e}"
    except Exception as e:
        return False, f"Email error: {e}"


def send_notification(config: dict, channels: list, title: str, message: str) -> dict:
    """Send to all specified channels. Returns dict of channel -> (success, error)."""
    results = {}
    for channel in channels:
        if channel == "ntfy":
            results["ntfy"] = send_ntfy(config, title, message)
        elif channel == "email":
            results["email"] = send_email(config, title, message)
    return results
