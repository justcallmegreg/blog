"""Thin AWS SES v2 wrapper: send mail, manage contacts, list subscribers."""
from __future__ import annotations

import boto3
from botocore.exceptions import ClientError


class Ses:
    def __init__(self, region: str, mail_from: str, contact_list: str, topic: str, client=None):
        self.client = client or boto3.client("sesv2", region_name=region)
        self.mail_from = mail_from
        self.contact_list = contact_list
        self.topic = topic

    def send(
        self,
        to: str,
        subject: str,
        body: str,
        reply_to: str | None = None,
        html: bool = False,
        list_mgmt: bool = False,
    ) -> str | None:
        content_body = {"Html": {"Data": body}} if html else {"Text": {"Data": body}}
        args: dict = {
            "FromEmailAddress": self.mail_from,
            "Destination": {"ToAddresses": [to]},
            "Content": {"Simple": {"Subject": {"Data": subject}, "Body": content_body}},
        }
        if reply_to:
            args["ReplyToAddresses"] = [reply_to]
        if list_mgmt and self.contact_list:
            # SES injects List-Unsubscribe + a hosted unsubscribe footer and
            # records opt-outs back into the contact list.
            args["ListManagementOptions"] = {
                "ContactListName": self.contact_list,
                "TopicName": self.topic,
            }
        resp = self.client.send_email(**args)
        return resp.get("MessageId")

    def subscribe(self, email: str) -> None:
        prefs = [{"TopicName": self.topic, "SubscriptionStatus": "OPT_IN"}]
        try:
            self.client.create_contact(
                ContactListName=self.contact_list,
                EmailAddress=email,
                TopicPreferences=prefs,
            )
        except ClientError as e:
            if e.response.get("Error", {}).get("Code") == "AlreadyExistsException":
                # Re-opt-in an existing contact (e.g. previously unsubscribed).
                self.client.update_contact(
                    ContactListName=self.contact_list,
                    EmailAddress=email,
                    TopicPreferences=prefs,
                )
            else:
                raise

    def unsubscribe(self, email: str) -> None:
        try:
            self.client.update_contact(
                ContactListName=self.contact_list,
                EmailAddress=email,
                TopicPreferences=[{"TopicName": self.topic, "SubscriptionStatus": "OPT_OUT"}],
            )
        except ClientError as e:
            # Nothing to unsubscribe is fine.
            if e.response.get("Error", {}).get("Code") != "NotFoundException":
                raise

    def subscribers(self) -> list[str]:
        """Email addresses opted-in to the digest topic."""
        emails: list[str] = []
        paginator = self.client.get_paginator("list_contacts")
        pages = paginator.paginate(
            ContactListName=self.contact_list,
            Filter={
                "TopicFilter": {
                    "TopicName": self.topic,
                    "UseDefaultIfPreferenceUnavailable": False,
                }
            },
        )
        for page in pages:
            for contact in page.get("Contacts", []):
                emails.append(contact["EmailAddress"])
        return emails
