document.querySelectorAll(".accordion details").forEach((details) => {
  const summary = details.querySelector("summary");
  const content = details.querySelector(".accordion__content");

  content.style.height = "0px";

  summary.addEventListener("click", (e) => {
    e.preventDefault();

    const isOpen = details.hasAttribute("open");

    // סגירת כל האחרים
    document
      .querySelectorAll(".accordion details[open]")
      .forEach((openDetails) => {
        if (openDetails !== details) {
          const openContent = openDetails.querySelector(".accordion__content");

          openContent.style.height = openContent.scrollHeight + "px";

          requestAnimationFrame(() => {
            openContent.style.height = "0px";
          });

          openContent.addEventListener(
            "transitionend",
            () => {
              openDetails.removeAttribute("open");
            },
            { once: true },
          );
        }
      });

    // אם כבר פתוח → לסגור
    if (isOpen) {
      content.style.height = content.scrollHeight + "px";

      requestAnimationFrame(() => {
        content.style.height = "0px";
      });

      content.addEventListener(
        "transitionend",
        () => {
          details.removeAttribute("open");
        },
        { once: true },
      );

      return;
    }

    // פתיחה
    details.setAttribute("open", true);

    const height = content.scrollHeight;

    content.style.height = "0px";

    requestAnimationFrame(() => {
      content.style.height = height + "px";
    });

    content.addEventListener(
      "transitionend",
      () => {
        content.style.height = "auto";
      },
      { once: true },
    );
  });
});
