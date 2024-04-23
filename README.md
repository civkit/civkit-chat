# Installation

- clone the repo
- run `npm install`
- run `./build.sh` if you haven't yet done so

# Building Updates

I haven't set up auto-compilation of typescript, so for the time being, run `./build.sh` whenever there's a change to the typescript code

# Running the Demo

First, run the app with `./run.sh`

Load the following URL in a browser: http://localhost:3456/ui/chat/make-offer

Click the "make offer" button, and you'll be taken to the chatroom. There's a link that you can share with someone else; open that in another browser (or a private/incognito window), and in the other browser, hit "accept offer".

At this point, the chatroom is available. Refresh the page if needed, and send secure messages between the two users (browsers).
