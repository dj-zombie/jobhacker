# Screenshots

The running app, with sample data: public companies and the fictional candidate in `config/profile.example.yaml`. The places in the filter are the example criteria. Marks in these frames are monograms. In ordinary use the browser loads the logo once a domain is known.

The triage view is also at the top of the README. Frames taken against a live database stay out of git.

## Triage

A ranked queue beside the selected job. The score and the reasons sit on the right. J and K move through the list, S shortlists, X skips.

![A ranked queue beside the selected job, with its score and the reasons](triage.png)

## Where

Portland, Phoenix, and Remote are a view filter. This frame is Remote only, so the queue drops from 12 jobs to 10. The others stay stored.

![The queue filtered to Remote](where.png)

## Tune the ranking

Drag a weight and the list re-ranks on this machine. No model call. Save writes the weights into `criteria.yaml`.

![Weight sliders and the score distribution beside the queue](tune.png)

## Shortlist

Jobs you kept. Prepare application writes the materials for the selected one.

![The shortlist, with Prepare application on the selected job](shortlist.png)

## Still unscored

Jobs the model has not reached. Prescore only decides which of them gets scored next. The four gates are the only things that remove a job, and this run removed none.

![Unscored jobs, with Score next batch](unscored.png)

## Applications

Prepped, submitted, interviewing, offer. A form that still needs a look shows it on the row.

![The application pipeline: two prepped, one submitted, one interviewing](applications.png)

## Fill report

Open & fill writes the form in your Chrome and lists every field. A drafted answer waits here for a look. Mark submitted records that you sent it.

![The fill report for one application, with one drafted answer to check](workspace.png)

## Keyboard

`?` opens the shortcuts.

![The keyboard shortcuts dialog](shortcuts.png)

## On a phone

The same queue. The sidebar is behind the menu.

![The queue at phone width](phone.png)
