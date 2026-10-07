"use client";

import type { ReactNode } from "react";
import { Button, Dialog, DialogTrigger, Heading, Modal, ModalOverlay } from "react-aria-components";
import styles from "./ConfirmDialog.module.css";

type Props = {
  /** The action's verb, on the button that opens the dialog and on the one that confirms it (§4). */
  action: string;
  title: string;
  children: ReactNode;
  /** The safe way out, such as "Keep order". */
  keepLabel: string;
  onConfirm: () => void;
  isDisabled?: boolean;
};

/** A question before an action that can't be undone. Focus stays inside until it closes, and Escape keeps things as they were. */
export function ConfirmDialog({ action, title, children, keepLabel, onConfirm, isDisabled }: Props) {
  return (
    <DialogTrigger>
      <Button className="button" isDisabled={isDisabled}>
        {action}
      </Button>
      <ModalOverlay className={styles.overlay}>
        <Modal className={styles.modal}>
          <Dialog role="alertdialog" className={styles.dialog}>
            {({ close }) => (
              <>
                <Heading slot="title" className={styles.title}>
                  {title}
                </Heading>
                <div className={styles.body}>{children}</div>
                <div className={styles.buttons}>
                  <Button className="button" onPress={close} autoFocus>
                    {keepLabel}
                  </Button>
                  <Button
                    className="button button-primary"
                    onPress={() => {
                      close();
                      onConfirm();
                    }}
                  >
                    {action}
                  </Button>
                </div>
              </>
            )}
          </Dialog>
        </Modal>
      </ModalOverlay>
    </DialogTrigger>
  );
}
