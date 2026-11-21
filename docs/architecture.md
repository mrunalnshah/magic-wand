# Architecture

> **Version** 6 | **Updated** 2026-11-21 | **Approved**

## 1. Overview

This document describes the architecture of the magic wand system. It covers:

- how data flows through the system when it collects data, trains a classifier
  and recognizes spells;
- the subsystems and the components in them, and what each is responsible
  for, including the shared library;
- the technical decisions, data formats and configuration that every
  subsystem follows;
- how the repository is organized;
- the items still to be filled in before final submission.

After reading it you will understand how the system works end to end and know
where to find the detail for any part of it.

The system recreates the magic wand experience of the Harry Potter area at
Universal Studios. A user waves a wand in front of a camera. The system
recognizes the motion as one of several predefined gestures (spells) and
responds with an action: a visual effect on screen, a sound, or, if time
permits, a physical device.

The system has three **subsystems**: data collection, training and
inference. Each has its own purpose, folder and documents. A **component** is a
building block inside a subsystem, such as vision or the classifier.
Components that more than one subsystem needs live in the shared library.

Terms such as subsystem, component, tip, gesture, sample, session and label
are defined in `docs/glossary.md`.

The wand is a brightly colored ping pong ball on a stick, so that OpenCV color
filtering can find it in the video. The system tracks the center of the ball,
called the tip. Five components turn video into an action:

1. **Vision** finds the tip in each frame.
2. **Motion detection** turns the tip's positions into gestures.
3. **Gesture normalization** gives every gesture the same length and form.
4. **Gesture classification** names the spell a gesture represents.
5. **Action trigger** performs the effect for that spell.

The classifier is a machine learning model, so it must be trained on labeled
examples. The subsystems relate as follows:

- **Data collection**: live video goes through vision and motion detection,
  and a person labels and stores the resulting gestures as a training dataset
  (about 1,000 samples per gesture). Many users contribute to the dataset,
  each recording on their own machine, and the datasets are merged for
  training.
- **Training**: stored gestures go through gesture normalization, and the
  result trains and evaluates classifiers.
- **Inference**: live video goes through all five components, in real time,
  using a trained classifier.

## 2. System Flow

### 2.1 Inference

Inference runs in real time. Each frame is processed as it arrives, so vision
and motion detection must keep up with the camera's frame rate, and a gesture
is classified and acted on as soon as it ends.

```text
 +--------+ frame  +--------+ tip position +-----------+
 | Camera |------->| Vision |------------->|  Motion   |
 +--------+        +--------+ + timestamp  | detection |
                                           +-----+-----+
                                                 | gesture (positions)
                                                 v
 +---------+ spell +------------+ fixed-   +---------------+
 | Action  |<------| Gesture    |<---------| Gesture       |
 | trigger | + conf| classifier | length   | normalization |
 +---------+       +------------+ vectors  +---------------+
```

1. The camera delivers frames. Each frame gets a timestamp.
2. Vision finds the tip in the frame and outputs its position with the
   frame's timestamp.
3. Motion detection watches the stream of tip positions. A gesture starts when
   the tip's speed rises above a threshold and ends when it falls below one.
   Motion that lasts too long or covers too little distance is discarded.
4. Gesture normalization converts the gesture's positions into motion vectors
   (direction and speed) of a fixed length, whatever the gesture's duration
   or the camera's frame rate (section 4.3).
5. The classifier receives the normalized gesture and outputs a spell and a
   confidence score.
6. The action trigger performs the action for the spell. If the confidence is
   below the minimum threshold, no action is performed and the user is told
   the gesture was not recognized.

### 2.2 Data collection

Data collection has two sub flows: calibration, then recording.

#### 2.2.1 Calibration

```text
 Pick camera --> Color calibration --> Motion tuning --> Start session
                 click the tip in      watch live motion   settings are
                 a frozen frame        detection, adjust   locked and
                                       the thresholds      recorded
```

1. The user picks the camera.
2. For color calibration, the app shows a frozen frame and the user clicks the
   tip. The app derives the vision settings (the color range of the ball) from
   the click and shows what it detects.
3. For motion tuning, the app shows the live view with a clear indication of
   motion or idle and the tip's current speed. The user adjusts the thresholds
   until motion triggers as expected.
4. The user can save the result as a profile for the same camera and room.
5. Starting a session locks the settings and records them in the session.

#### 2.2.2 Recording

```text
 +--------+ frame  +--------+ tip position +-----------+
 | Camera |------->| Vision |------------->|  Motion   |
 +--------+        +--------+ + timestamp  | detection |
                                           +-----+-----+
                                                 | gesture (positions)
                                                 v
 +--------+  label, accept or reject    +-----------------+
 |  User  |<--------------------------->| Data collection |
 +--------+                             +--------+--------+
                                                 | sample: positions
                                                 | + label + status
                                                 v
                                        +-----------------+
                                        | Dataset (disk)  |
                                        +-----------------+
```

1. Vision and motion detection run as in inference, with the same code and the
   settings from calibration.
2. The user chooses a label and starts capturing. The app paces the captures
   with a countdown.
3. Motion detection reports a gesture. The app turns it into a sample: the
   tip positions of the gesture, not the vectors.
4. The sample takes the label the user chose and is accepted by default. The
   user reviews it and can reject, relabel or delete it.
5. The sample, with the user's label and status, is written to the dataset as
   part of the current session. Changes the user makes during review update
   the stored sample.

#### 2.2.3 What is stored

A dataset holds sessions, and each session holds samples:

```text
 Dataset
 +-- Session (one per recording run)
     |   name, author, handedness, notes
     |   camera and the mode it delivered
     |   settings used: vision settings, motion settings, clip padding
     |
     +-- Sample (many per session)
         |   label, status (accepted or rejected), handedness
         |   positions: the timestamped tip positions of the gesture
         |
         +-- Video clip (optional): the footage around the gesture
```

- A session belongs to one author and one camera, and has one set of
  settings. Every sample in the session was captured with those settings.
- A sample belongs to one session. It has one label, one status, one sequence
  of positions and at most one video clip.
- Labels are not part of the dataset. A sample refers to its label by
  identifier, and the labels are defined in the shared configuration
  (`config/labels.yaml`).
- The settings in a session start from the defaults in the configuration or a
  saved profile, as described under Configuration.

File formats and layout are in `docs/data-handling.md`.

### 2.3 Training

```text
 Dataset (user A) --+
 Dataset (user B) --+--> Merge --> Training dataset
 Dataset (user C) --+                   |
                                            v
                       Load accepted samples, normalize each gesture
                                            |
                                            v
                       Split by session into training and test sets
                                            |
                         +------------------+------------------+
                         v                                     v
                  Train each classifier              Build test cases
                         |                                     |
                         +-----------> Evaluate <--------------+
                                          |
                                          v
                        Trained classifier + metrics + threshold
                                 (used in inference)
```

1. Each user records sessions on their own machine. The datasets are
   merged into one training dataset; merging copies whole sessions and never
   changes them (see `docs/data-handling.md`).
2. Training loads the accepted samples of the spell labels and normalizes each
   gesture with the shared library (section 4.3).
3. The samples are split by session, so that samples recorded in one session
   (one person, camera and lighting) are never on both sides of the split.
   The split can also hold out one author at a time, to measure how well a
   classifier works for a person it has not seen.
4. Each classifier is trained on the training side. Every classifier gets the
   same split, so the results are comparable.
5. The test side is turned into three kinds of test cases: held-out spells,
   backward spells (the held-out spells with their positions in reverse
   order) and non-spell recordings. A backward spell counts as not a spell.
6. Evaluation measures how often a classifier names the right spell, how often
   it triggers on a backward spell or a non-spell, and the time it takes per
   gesture. The measures are computed over a range of confidence thresholds.
7. The results pick the classifier and its confidence threshold. The trained
   classifier is saved with the evidence for the choice, and the inference
   flow loads it.

Non-spell recordings are stored as ordinary samples under a label that
`config/labels.yaml` marks as not a spell. Training does not learn that label
as a class; it uses those samples only as test cases.

### 2.4 Shared Implementation

Vision, motion detection, gesture normalization and the classifiers are
implemented once, in the shared library, and every subsystem runs that
implementation. A gesture seen live therefore has the same form as a gesture
the classifier was trained on. Vectors are computed from positions at load
time rather than stored, so changing how vectors are built or normalized does
not require re-recording.

## 3. Subsystems

### 3.1 Data collection

An application for recording, labeling and reviewing gestures. It hosts vision
and motion detection, adds calibration, the labeling workflow and review, and
writes datasets. Design: `data-collection/docs/design.md`.

### 3.2 Training

A command-line tool that turns a training dataset into a trained classifier.
It merges datasets, splits and normalizes the samples, trains and evaluates
classifiers, and saves the result.

- **Several classifiers, one workflow.** Every classifier is trained,
  evaluated and saved in the same way, through the classifier interface in the
  shared library. Adding a classifier does not change the workflow.
- **Experiments.** One configuration file describes one experiment: the
  dataset, the split, the normalization settings and the classifiers with
  their settings.
- **Runs.** Each run writes its own folder holding the experiment
  configuration, the identity of the dataset it used, the metrics and the
  trained classifiers, so that any result can be traced and repeated.
- **Comparison.** A report puts the runs side by side on the measures in
  section 2.3.

The classifiers to compare are Naive Bayes, a support vector machine, a random
forest and a neural network for time series. Design:
`training/docs/design.md`.

### 3.3 Inference

The application that recognizes spells live. It runs the pipeline of section
2.1 on the camera's video with a trained classifier and the calibration for
the current camera and room, shows the live view, and hosts the action
trigger. Design: `inference/docs/design.md`.

## 4. Components

### 4.1 Vision

Finds the tip in each frame by filtering for the ball's color and locating the
resulting shape. Input: camera frames. Output: tip position and timestamp (or
"not found") per frame. Its color settings are tuned for each camera and
lighting condition by calibration.

### 4.2 Motion detection

Tracks the tip's speed to separate idle from motion and cuts the stream into
gestures. Input: tip positions with timestamps. Output: gestures, and the live
state (moving or idle). Its thresholds and time window are settings that
calibration adjusts.

### 4.3 Gesture normalization

Gestures differ in duration (a quick flick or a slow circle) and in the number
of positions (cameras deliver different frame rates and drop frames), while
most classifiers need an input of one fixed size. Normalization turns any
gesture into the same form, in four steps:

1. **Resample.** The positions are resampled to a fixed number of points,
   spaced at equal time intervals from the first position to the last, by
   linear interpolation. A gesture with fewer positions is interpolated up to
   that number of points.
2. **Vectors.** The displacement between consecutive points (horizontal and
   vertical, in frame-heights) is one motion vector. The points are equally
   spaced in time, so a vector's length shows how fast that part of the gesture
   was relative to the rest, and the vector's direction keeps the order of the
   motion. A circle drawn clockwise and counterclockwise gives opposite
   vectors.
3. **Context values.** Resampling removes the gesture's duration, so the
   duration in seconds is added as a separate value. The start position can
   also be added, so that a classifier can use where in the frame the gesture
   was drawn.
4. **Output.** The vectors and context values come in two shapes: a flat list
   of numbers for Naive Bayes, the support vector machine and the random
   forest, and a sequence for the neural network.

The number of points and the choice of context values are settings of the
experiment. They are saved with the trained classifier, and inference applies
the same ones. Input: the positions of one gesture. Output: the normalized
gesture.

Resampling in time, and not along the path's length, keeps the speed profile
of the gesture, which can tell spells apart.

### 4.4 Gesture classification

A model trained on labeled gestures. Input: one normalized gesture. Output: a
spell (a label identifier) and a confidence score between 0 and 1.

- Every classifier family implements one interface: train on labeled gestures,
  predict a spell with its confidence, save and load. Training and inference
  both use it.
- The confidence is the probability the model gives to the predicted spell.
- A motion that is not a spell, or a spell drawn backward, is rejected by a low
  confidence, not by a class of its own. The confidence threshold that rejects
  them is chosen in training.
- A trained classifier is saved with its list of labels, the normalization
  settings it needs, and the recommended confidence threshold.
- The classifier does not decide whether to act on the result; the action
  trigger applies the confidence threshold.

### 4.5 Action trigger

Maps a recognized spell to an effect: an on-screen visual, a sound, or, if
time permits, device control. Input: a spell and its confidence. The effect for
each spell is set in `config/actions.yaml`. The trigger applies the confidence
threshold: below it nothing is performed and the user is told the gesture was
not recognized. The threshold starts at the value saved with the classifier
and can be overridden in configuration.

### 4.6 Shared library

The library (`wand-core`) contains the components that must behave identically
in more than one subsystem. Design: `lib/docs/design.md`.

- **Frame sources** deliver camera frames with timestamps, from either a live
  camera or a recorded video file, so the rest of the library runs the same on
  both.
- **Tracker** finds the tip in one frame using the vision settings. It is the
  vision component.
- **Segmenter** watches the tip positions and decides when a gesture starts
  and ends, using the motion settings. It reports finished gestures, discarded
  motion and the live moving or idle state.
- **Normalizer** implements gesture normalization.
- **Classifiers** hold the classifier interface and the classifier families,
  and save and load trained classifiers. The heavy dependency of the neural
  network is optional, so an installation without it still runs the other
  families.
- **Color calibrator** derives vision settings from points the user clicks on
  the tip.
- **Motion calibrator** proposes motion settings from a short measurement of
  the user holding still and then waving.
- **Dataset store** reads, writes, filters, exports and merges datasets in the
  format in `docs/data-handling.md`.
- **Path renderer** draws a gesture's path as an image.

Each subsystem imports the library and supplies what the library does not
have: the camera, the user interface and the application logic. The library
never opens a camera or draws a user interface by itself, so it can be tested
with recorded video and synthetic data.

## 5. Conventions

### 5.1 Technical decisions

| Decision | Reason |
|---|---|
| Single mono-repo | Components share code and evolve together |
| Python 3.11 or later | OpenCV and ML ecosystem |
| OpenCV color filtering | The wand is a brightly colored ball |
| One shared library | Identical processing for training and inference |
| Classifiers in the library | Training and inference load the same code |
| Resampling in time | Keeps the speed profile and order of the motion |
| Split by session | Samples of one session resemble each other |
| uv workspace, ruff | Reproducible environments, one style |
| YAML for configuration | Human-edited, supports comments |
| JSON for recorded data | Small files, readable, safe to edit atomically |
| macOS and Linux | Windows is best effort and untested |

Tooling and workflow rules are in `docs/standards.md`.

### 5.2 Data across the system

Data collection produces datasets and calibrated settings. This is how each
kind of data is used afterwards.

- **Samples** (timestamped tip positions with a label and status) are the
  training data. Motion vectors are computed from the positions by the shared
  library, the same way inference computes vectors from live positions.
- **Settings** (vision and motion) are recorded in every session so that the
  conditions of each sample are known. At inference the run-time application
  applies settings of the same kind, from a calibration done for the current
  camera and room, to live video. This keeps live gestures comparable to
  training gestures.
- **Labels** are identifiers. The classifier outputs a label identifier and a
  confidence between 0 and 1; the run-time application maps the identifier to
  its display name and the action to perform.
- **Video clips** help debug detection and classification. Inference does not
  use them.

Common formats used by every subsystem:

- **Position**: the tip's horizontal and vertical position as fractions of the
  frame width and height (0 to 1, vertical axis pointing down), with the frame
  size stored beside it.
- **Distance and speed**: in frame-heights and frame-heights per second. The
  horizontal fraction is scaled by the frame's aspect ratio so both axes use
  one unit. Thresholds in these units do not depend on camera resolution.
- **Time**: seconds. Within a gesture, time is measured from its first
  position.

Field-level definitions are in `lib/docs/design.md` and
`docs/data-handling.md`. The rules for handling datasets are in
`docs/data-handling.md`.

### 5.3 Configuration

All configuration is in `config/`.

- `labels.yaml` (in git): the labels. Each has an identifier, used in stored
  samples and in classifier output, a display name shown to users, and whether
  it is a spell (a label for non-spell recordings is not). Data collection
  reads and edits it.
- `vision.yaml` (in git): default values for the vision settings, such as the
  ball's color range and size limits. Calibration starts from these.
- `motion.yaml` (in git): default values for the motion settings, such as the
  speed thresholds, the valid gesture duration and the minimum gesture size.
  Calibration starts from these.
- `actions.yaml` (in git): the effect for each spell, and the confidence
  threshold override of the action trigger.
- `data-collection.yaml` (in git): settings of the data collection
  application, such as where datasets are stored, the requested camera mode,
  the countdown length, the video clip padding and the keyboard shortcuts.
- `*.local.yaml` (not in git): a per-machine override. Values in
  `data-collection.local.yaml` replace those in `data-collection.yaml`, for
  example to use a different dataset folder.
- `profiles/` (not in git): calibration profiles that the user saved for a
  particular camera, room and lighting. A profile holds a full set of vision
  and motion settings.

The vision and motion settings used for recording are built up in steps. They
start as the defaults from `vision.yaml` and `motion.yaml`. Loading a profile
replaces them with the profile's values. Adjustments on the calibration
screens then change individual values. When a session starts, the final values
are copied into the session, so the data states the exact settings its samples
were captured with.

## 6. Folder Organization

```text
magic-wand/
  README.md           project introduction and documentation index
  pyproject.toml      uv workspace root; shared tool settings (ruff)
  uv.lock             resolved dependency versions for the workspace
  CLAUDE.md           project and agent instructions
  config/             configuration
  docs/               system-wide documentation
  lib/                shared library
    docs/
    src/              library code
    tests/
  data-collection/    data collection application
    docs/             requirements, design, tasks
    src/              application code
    tests/
  training/           training tool
    docs/             requirements, design, tasks
    src/              training code
    tests/
  inference/          inference application
    docs/             requirements, design, tasks
    src/              application code
    tests/
  data/               default dataset location; not in git
  runs/               default location of training runs; not in git
  models/             trained classifiers chosen for inference
```

Each subsystem is a workspace member with its own `pyproject.toml`, `docs/`,
`src/` and `tests/`. The `training/` and `inference/` folders are created when
their tasks start.

## 7. To Do

Items to fill in before final submission:

- Training design: the experiment configuration format, the default number of
  points and context values for normalization, the settings of each
  classifier, whether training adds an explicit reject class, and how
  left-handed samples are treated.
- Data collection: recording non-spell samples under a label that is not a
  spell.
- Action trigger: the effects for each spell, and physical actuation if time
  permits.
- Inference application: its user interface and how it applies a calibration
  profile.
- Final values for the motion settings, tuned from real recordings.
