package com.aurral.tv.setup;

import java.io.*;
import java.net.InetAddress;

/** Runs the actual TV HTTP receiver over loopback while the Node test supplies the box opener. */
public final class InboxFixture {
    public static void main(String[] args) throws Exception {
        BufferedReader decisions = new BufferedReader(new InputStreamReader(System.in));
        try (LanInbox inbox = new LanInbox(InetAddress.getByName("127.0.0.1"), args[0], Long.parseLong(args[1]))) {
            System.out.println(inbox.port());
            try {
                while (true) {
                    System.out.println(inbox.next());
                    boolean accepted = "accepted".equals(decisions.readLine());
                    inbox.finish(accepted);
                    if (accepted) break;
                }
            } catch (IOException closed) {
                // Expiry and the failed-attempt limit close the listener.
            }
        }
    }
}
