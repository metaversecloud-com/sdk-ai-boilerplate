import { useState } from "react";

export const ConfirmationModal = ({
  title,
  message,
  handleOnConfirm,
  handleToggleShowConfirmationModal,
}: {
  title: string;
  message: string;
  handleOnConfirm: () => void;
  handleToggleShowConfirmationModal: () => void;
}) => {
  const [areButtonsDisabled, setAreButtonsDisabled] = useState(false);

  const onConfirm = () => {
    setAreButtonsDisabled(true);
    handleOnConfirm();
    handleToggleShowConfirmationModal();
  };

  return (
    <div className="modal-container">
      <div className="modal">
        <div className="modal-header flex gap-2 grid-cols-2">
          <h4 className="flex-grow text-left">{title}</h4>
          <a
            className="pt-2 cursor-pointer"
            onClick={handleToggleShowConfirmationModal}
            aria-label="Close"
            title="Close"
          >
            <img src="https://sdk-style.s3.amazonaws.com/icons/x.svg" alt="" aria-hidden="true" />
          </a>
        </div>
        <p>{message}</p>
        <div className="actions">
          <button
            id="close"
            className="btn btn-outline"
            onClick={handleToggleShowConfirmationModal}
            disabled={areButtonsDisabled}
          >
            No
          </button>
          <button className="btn btn-danger-outline" onClick={onConfirm} disabled={areButtonsDisabled}>
            Yes
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmationModal;
