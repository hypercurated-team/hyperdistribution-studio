#!/usr/bin/env python3
"""Builds the HyperJudge iPhone shortcut (unsigned).

    python3 shortcuts/build_hyperjudge.py [API base] > HyperJudge-unsigned.shortcut

iOS only imports signed shortcuts. Sign on a Mac:

    shortcuts sign --mode anyone --input HyperJudge-unsigned.shortcut --output HyperJudge.shortcut

What the shortcut does, in order:
  1. Take Screenshot (the reel you're watching)
  2. Extract Text from Image (on the phone)
  3. Choose from List: a scrolling list, 1K, 2K, 5K … 5M, 10M+
  4. Get Device Details: device name (your name on the leaderboard)
  5. POST {text, guess, player} to <API base>/api/judge?format=text
  6. Show Notification with the reply (three short lines)
"""
import plistlib
import sys
import uuid

API = (sys.argv[1] if len(sys.argv) > 1 else "https://hyperdistribution-studio.vercel.app").rstrip("/")


def uid():
    return str(uuid.uuid4()).upper()


def ref(out_uuid, name):
    return {"OutputUUID": out_uuid, "Type": "ActionOutput", "OutputName": name}


def attachment(out_uuid, name):
    """A whole parameter that is one action's output."""
    return {"Value": ref(out_uuid, name), "WFSerializationType": "WFTextTokenAttachment"}


def text_with(out_uuid, name):
    """A text field holding just one variable."""
    return {
        "Value": {"string": "￼", "attachmentsByRange": {"{0, 1}": ref(out_uuid, name)}},
        "WFSerializationType": "WFTextTokenString",
    }


def plain(s):
    return {"Value": {"string": s}, "WFSerializationType": "WFTextTokenString"}


def action(ident, params, out=None):
    p = dict(params)
    if out:
        p["UUID"] = out
    return {"WFWorkflowActionIdentifier": ident, "WFWorkflowActionParameters": p}


shot, ocr, ranges, chosen, device, reply = (uid() for _ in range(6))

actions = [
    action("is.workflow.actions.comment", {"WFCommentActionText": "HyperJudge by HyperMixer. Guess the creator's followers while you watch a reel. Run it from AssistiveTouch (Settings > Accessibility > Touch > AssistiveTouch > Single-Tap > HyperJudge)."}),
    action("is.workflow.actions.takescreenshot", {}, shot),
    action("is.workflow.actions.extracttextfromimage", {"WFImage": attachment(shot, "Screenshot")}, ocr),
    action("is.workflow.actions.list", {"WFItems": ["1K", "2K", "5K", "10K", "20K", "50K", "100K", "200K", "500K", "1M", "2M", "5M", "10M+"]}, ranges),
    action(
        "is.workflow.actions.choosefromlist",
        {"WFInput": attachment(ranges, "List"), "WFChooseFromListActionPrompt": "How many followers?"},
        chosen,
    ),
    action("is.workflow.actions.getdevicedetails", {"WFDeviceDetail": "Device Name"}, device),
    action(
        "is.workflow.actions.downloadurl",
        {
            "WFURL": f"{API}/api/judge?format=text",
            "WFHTTPMethod": "POST",
            "WFHTTPBodyType": "JSON",
            "ShowHeaders": False,
            "WFJSONValues": {
                "Value": {
                    "WFDictionaryFieldValueItems": [
                        {"WFItemType": 0, "WFKey": plain("text"), "WFValue": text_with(ocr, "Text from Image")},
                        {"WFItemType": 0, "WFKey": plain("guess"), "WFValue": text_with(chosen, "Chosen Item")},
                        {"WFItemType": 0, "WFKey": plain("player"), "WFValue": text_with(device, "Device Details")},
                    ]
                },
                "WFSerializationType": "WFDictionaryFieldValue",
            },
        },
        reply,
    ),
    action(
        "is.workflow.actions.notification",
        {"WFNotificationActionTitle": "HyperJudge", "WFNotificationActionBody": text_with(reply, "Contents of URL"), "WFNotificationActionSound": True},
    ),
]

shortcut = {
    "WFWorkflowMinimumClientVersion": 900,
    "WFWorkflowMinimumClientVersionString": "900",
    "WFWorkflowClientVersion": "2302.0.4",
    "WFWorkflowIcon": {"WFWorkflowIconStartColor": 463140863, "WFWorkflowIconGlyphNumber": 59511},
    "WFWorkflowImportQuestions": [],
    "WFWorkflowTypes": [],
    "WFQuickActionSurfaces": [],
    "WFWorkflowInputContentItemClasses": [],
    "WFWorkflowOutputContentItemClasses": [],
    "WFWorkflowHasShortcutInputVariables": False,
    "WFWorkflowHasOutputFallback": False,
    "WFWorkflowActions": actions,
}

sys.stdout.buffer.write(plistlib.dumps(shortcut, fmt=plistlib.FMT_BINARY))
