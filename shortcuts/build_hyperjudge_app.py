#!/usr/bin/env python3
"""Builds the shortcut that ships inside the HyperJudge app (unsigned).

    python3 shortcuts/build_hyperjudge_app.py > HyperJudge-app-unsigned.shortcut
    shortcuts sign --mode anyone --input HyperJudge-app-unsigned.shortcut \
        --output hyperjudge/assets/HyperJudge.shortcut

Three steps: Take Screenshot → Extract Text from Image → Start HyperJudge Round
(the App Intent in hyperjudge/targets/widget/_shared/HJShared.swift). The guess and the
result happen in the Dynamic Island, so the shortcut has nothing else to do.
"""
import plistlib
import sys
import uuid

BUNDLE = "com.kraftxworks.hyperjudge"
TEAM = "J7ZVMZND97"


def uid():
    return str(uuid.uuid4()).upper()


def ref(out_uuid, name):
    return {"OutputUUID": out_uuid, "Type": "ActionOutput", "OutputName": name}


shot, ocr = uid(), uid()

actions = [
    {
        "WFWorkflowActionIdentifier": "is.workflow.actions.takescreenshot",
        "WFWorkflowActionParameters": {"UUID": shot},
    },
    {
        "WFWorkflowActionIdentifier": "is.workflow.actions.extracttextfromimage",
        "WFWorkflowActionParameters": {
            "UUID": ocr,
            "WFImage": {"Value": ref(shot, "Screenshot"), "WFSerializationType": "WFTextTokenAttachment"},
        },
    },
    {
        "WFWorkflowActionIdentifier": f"{BUNDLE}.StartRoundIntent",
        "WFWorkflowActionParameters": {
            "AppIntentDescriptor": {
                "TeamIdentifier": TEAM,
                "BundleIdentifier": BUNDLE,
                "Name": "HyperJudge",
                "AppIntentIdentifier": "StartRoundIntent",
            },
            "text": {
                "Value": {"string": "￼", "attachmentsByRange": {"{0, 1}": ref(ocr, "Text from Image")}},
                "WFSerializationType": "WFTextTokenString",
            },
        },
    },
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
